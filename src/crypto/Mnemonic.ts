import * as bip39 from "bip39";
import { Ed25519PrivateKey } from "./Ed25519PrivateKey";
import { MnemonicValidationResult } from "./MnemonicValidationResult";
import { MnemonicValidationStatus } from "./MnemonicValidationStatus";

/** result of `generateMnemonic()` */
export class Mnemonic {
    public readonly words: string[];

    /**
     * Recover a mnemonic from a list of 24 words.
     *
     * @param words
     */
    public constructor(words: string[]) {
        this.words = words;
    }

    /** Lazily generate the key, providing an optional passphrase to protect it with */
    public toPrivateKey(passphrase: string): Promise<Ed25519PrivateKey> {
        return Ed25519PrivateKey.fromMnemonic(this, passphrase);
    }

    /**
     * Generate a random 24-word mnemonic.
     *
     * If you are happy with the mnemonic produced you can call {@link .toPrivateKey} on the
     * returned object.
     *
     * This mnemonics that are compatible with the Android and iOS mobile wallets.
     *
     * **NOTE:** Mnemonics must be saved separately as they cannot be later recovered from a given
     * key.
     */
    public static generate(): Mnemonic {
        // 256-bit entropy gives us 24 words
        return new Mnemonic(bip39.generateMnemonic(256).split(" "));
    }

    /**
     * Recover a mnemonic phrase from a string, splitting on spaces.
     *
     * @param mnemonic
     */
    public static fromString(mnemonic: string): Mnemonic {
        return new Mnemonic(mnemonic.split(" "));
    }

    /**
     * Validate that this is a valid BIP-39 mnemonic as generated by BIP-39's rules.
     * <p>
     * Technically, invalid mnemonics can still be used to generate valid private keys,
     * but if they became invalid due to user error then it will be difficult for the user
     * to tell the difference unless they compare the generated keys.
     * <p>
     * During validation, the following conditions are checked in order:
     * <ol>
     *     <li>{@link this.words.length} == 24</li>
     *     <li>All strings in {@link this.words} exist in the BIP-39 standard English word list (no normalization is done).</li>
     *     <li>The calculated checksum for the mnemonic equals the checksum encoded in the mnemonic.</li>
     * </ol>
     * <p>
     *
     * @return the result of the validation.
     * @see {@link https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki | Bitcoin Improvement Project proposal 39 (BIP-39) }
     * @see {@link https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt | BIP-39 English word list }
     */
    public validate(): MnemonicValidationResult {
        if (this.words.length !== 24) {
            return new MnemonicValidationResult(MnemonicValidationStatus.BadLength);
        }

        const unknownIndices = this.words.reduce(
            (unknowns: number[], word, index) =>
                // eslint-disable-next-line implicit-arrow-linebreak
                bip39.wordlists.english.includes(word) ? unknowns : [ ...unknowns, index ],
            []
        );

        if (unknownIndices.length > 0) {
            return new MnemonicValidationResult(
                MnemonicValidationStatus.UnknownWords,
                unknownIndices
            );
        }

        // this would cover length and unknown words but it only gives us a `boolean`
        // we validate those first and then let `bip39` do the non-trivial checksum verification
        if (!bip39.validateMnemonic(this.words.join(" "), bip39.wordlists.english)) {
            return new MnemonicValidationResult(MnemonicValidationStatus.ChecksumMismatch);
        }

        return new MnemonicValidationResult(MnemonicValidationStatus.Ok);
    }

    public toString(): string {
        return this.words.join(" ");
    }
}
