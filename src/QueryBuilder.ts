import { BaseClient, Node } from "./BaseClient";
import { QueryHeader, ResponseType } from "./generated/QueryHeader_pb";
import { Query } from "./generated/Query_pb";
import { Response } from "./generated/Response_pb";
import { MaxPaymentExceededException, throwIfExceptional } from "./errors";
import { getResponseHeader, runValidation } from "./util";
import { grpc } from "@improbable-eng/grpc-web";
import { CryptoTransferTransaction } from "./account/CryptoTransferTransaction";
import { Transaction } from "./generated/Transaction_pb";
import { Hbar } from "./Hbar";
import { Tinybar } from "./Tinybar";

export abstract class QueryBuilder<T> {
    protected readonly _inner: Query;

    private readonly _header: QueryHeader;

    protected readonly _needsPayment: boolean;

    private _node?: Node;

    private maxCost?: Hbar;
    private amount?: Tinybar | Hbar;

    protected constructor(header: QueryHeader) {
        this._inner = new Query();
        this._header = header;
        this._needsPayment = true;
    }

    public setMaxQueryCost(amount: Tinybar | Hbar): this {
        this.maxCost = amount instanceof Hbar ?
            amount as Hbar :
            Hbar.fromTinybar(amount as Tinybar);
        return this;
    }

    /**
     * Attach a signed payment from the operator account for the given amount.
     *
     * Note that unlike transaction fees, this is an exact payment which will be deducted
     * from the operator account. You probably want to use `.requestCost()` to get the actual
     * cost of the query from the network.
     *
     * @throws TinybarValueError if the value is out of range for the protocol
     */
    public setPaymentAmount(amount: Tinybar | Hbar): this {
        this.amount = amount;
        return this;
    }

    private async _setPaymentAmount(amount: Tinybar | Hbar, client: BaseClient): Promise<this> {
        const nodeId = this._getNode(client).id;

        const payment = new CryptoTransferTransaction()
            .setNodeAccountId(nodeId)
            .addRecipient(nodeId, this.amount ? this.amount : amount)
            .addSender(client.operator!.account, this.amount ? this.amount : amount)
            .setMaxTransactionFee(Hbar.of(1))
            .build(client);

        await payment.signWith(client.operatorPublicKey!, client.operatorSigner!);

        this._header.setPayment(payment.toProto());

        return this;
    }

    /**
     * Set a manually created and signed `CryptoTransferTransaction` as the query payment.
     */
    public setPayment(transaction: Transaction): this {
        this._header.setPayment(transaction);
        return this;
    }

    protected abstract _doValidate(errors: string[]): void;

    public validate(): void {
        runValidation(this, (errors) => {
            if (!this._header.hasPayment()) {
                errors.push("`.setPayment()` required");
            }

            this._prepaymentValidate(errors);
        });
    }

    private _prepaymentValidate(errors: string[]): void {
        this._doValidate(errors);
    }

    /**
     * Request the cost of this query in HBAR from the node.
     *
     * You can then attach a payment for this value with `.setPaymentAmount()`.
     */
    public async getCost(client: BaseClient): Promise<Hbar> {
        runValidation(this, (errors) => this._prepaymentValidate(errors));

        // create a duplicate of the query with `COST_ANSWER` instead of the original response type
        // we also must have a signed payment of 0 hbar which is not actually processed
        const responseType = this._header.getResponsetype();
        this._header.setResponsetype(ResponseType.COST_ANSWER);

        const payment = this._header.getPayment();
        await this._setPaymentAmount(0, client);

        const query = this._inner.clone() as Query;

        this._header.setResponsetype(responseType);
        this._header.setPayment(payment);

        const node = this._getNode(client);

        const response = await client._unaryCall(node.url, query, this._method);

        const responseHeader = getResponseHeader(response);
        throwIfExceptional(responseHeader.getNodetransactionprecheckcode());

        return Hbar.fromTinybar(responseHeader.getCost());
    }

    private _getNode(client: BaseClient): Node {
        if (!this._node) {
            this._node = client._randomNode();
        }

        return this._node;
    }

    public async execute(client: BaseClient): Promise<T> {
        const node = this._getNode(client);

        if ((client.maxQueryPayment || this.maxCost) &&
            this._needsPayment && !this._header.hasPayment()) {
            const cost = await this.getCost(client);

            if ((this.maxCost && this.maxCost.comparedTo(cost) < 0) ||
                (client.maxQueryPayment && client.maxQueryPayment.comparedTo(cost) < 0)) {
                throw new MaxPaymentExceededException(
                    cost,
                    client.maxQueryPayment ? client.maxQueryPayment : this.maxCost!
                );
            }

            await this._setPaymentAmount(cost, client);
        } else if (this.amount && this._needsPayment && !this._header.hasPayment()) {
            await this._setPaymentAmount(this.amount, client);
        }

        this.validate();

        const response = await client._unaryCall(node.url, this._inner, this._method);

        const responseHeader = getResponseHeader(response);
        throwIfExceptional(responseHeader.getNodetransactionprecheckcode());

        return this._mapResponse(response);
    }

    public toProto(): Query {
        return this._inner;
    }

    protected abstract get _method(): grpc.UnaryMethodDefinition<Query, Response>;

    protected abstract _mapResponse(response: Response): T;
}
