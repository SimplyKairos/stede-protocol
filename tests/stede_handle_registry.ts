import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const HANDLE_REGISTRY_PROGRAM_ID = new PublicKey(
  "FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA"
);
const HANDLE_SEED = "handle";
const WALLET_SEED = "wallet";
const ANTI_SQUAT_DEPOSIT = 10_000_000;
const TEST_WALLET_FUNDING = Math.floor(0.1 * LAMPORTS_PER_SOL);
const SMALL_WALLET_FUNDING = Math.floor(0.03 * LAMPORTS_PER_SOL);

type HandleAccount = {
  owner: PublicKey;
  name: string;
  claimedAt: BN;
  bump: number;
};

type ReverseAccount = {
  handle: string;
  bump: number;
};

type ClaimFixture = {
  claimer: Keypair;
  name: string;
  handlePda: PublicKey;
  reversePda: PublicKey;
};

describe("stede_handle_registry", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;
  let happyPathFixture: ClaimFixture;

  before(async function () {
    program = await Program.at(HANDLE_REGISTRY_PROGRAM_ID.toBase58(), provider);
  });

  function deriveHandlePda(name: string): PublicKey {
    const [handlePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(HANDLE_SEED), Buffer.from(name)],
      HANDLE_REGISTRY_PROGRAM_ID
    );
    return handlePda;
  }

  function deriveReversePda(owner: PublicKey): PublicKey {
    const [reversePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(WALLET_SEED), owner.toBuffer()],
      HANDLE_REGISTRY_PROGRAM_ID
    );
    return reversePda;
  }

  function randomHandle(prefix: string): string {
    return `${prefix}${Math.random().toString(36).substring(2, 9)}`;
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function fundKeypair(
    keypair: Keypair,
    lamports = TEST_WALLET_FUNDING,
    label = "Fund test wallet"
  ): Promise<string> {
    const tx = await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: keypair.publicKey,
          lamports,
        })
      ),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, `${label} ${keypair.publicKey.toBase58()}`);
    return tx;
  }

  async function createFundedKeypair(
    lamports = TEST_WALLET_FUNDING
  ): Promise<Keypair> {
    const keypair = Keypair.generate();
    await fundKeypair(keypair, lamports);
    return keypair;
  }

  function createClaimFixture(claimer: Keypair, name: string): ClaimFixture {
    return {
      claimer,
      name,
      handlePda: deriveHandlePda(name),
      reversePda: deriveReversePda(claimer.publicKey),
    };
  }

  async function claimHandle(
    fixture: ClaimFixture,
    label = "Claim handle"
  ): Promise<string> {
    console.log(
      `${label}: '${
        fixture.name
      }' by ${fixture.claimer.publicKey.toBase58()} with ${ANTI_SQUAT_DEPOSIT} lamport deposit`
    );
    const tx = await (program.methods as any)
      .claimHandle(fixture.name)
      .accounts({
        claimer: fixture.claimer.publicKey,
        handleAccount: fixture.handlePda,
        reverseAccount: fixture.reversePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([fixture.claimer])
      .rpc();

    await confirmTx(tx, `${label} '${fixture.name}'`);
    return tx;
  }

  async function releaseHandle(
    fixture: ClaimFixture,
    owner: Keypair = fixture.claimer,
    label = "Release handle"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .releaseHandle()
      .accounts({
        owner: owner.publicKey,
        handleAccount: fixture.handlePda,
        reverseAccount: deriveReversePda(owner.publicKey),
      })
      .signers([owner])
      .rpc();

    await confirmTx(tx, `${label} '${fixture.name}'`);
    return tx;
  }

  async function transferHandle(
    fixture: ClaimFixture,
    currentOwner: Keypair,
    newOwner: Keypair,
    label = "Transfer handle"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .transferHandle()
      .accounts({
        currentOwner: currentOwner.publicKey,
        newOwner: newOwner.publicKey,
        handleAccount: fixture.handlePda,
        oldReverse: deriveReversePda(currentOwner.publicKey),
        newReverse: deriveReversePda(newOwner.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([currentOwner, newOwner])
      .rpc();

    await confirmTx(tx, `${label} '${fixture.name}'`);
    return tx;
  }

  async function fetchHandle(handlePda: PublicKey): Promise<HandleAccount> {
    return (program.account as any).handle.fetch(handlePda);
  }

  async function fetchReverse(reversePda: PublicKey): Promise<ReverseAccount> {
    return (program.account as any).reverse.fetch(reversePda);
  }

  async function claimFreshHandle(
    prefix: string,
    lamports = TEST_WALLET_FUNDING
  ): Promise<ClaimFixture> {
    const claimer = await createFundedKeypair(lamports);
    const fixture = createClaimFixture(claimer, randomHandle(prefix));
    await claimHandle(fixture);
    return fixture;
  }

  function errorMatches(
    err: unknown,
    expectedName: string,
    expectedCode: number
  ): boolean {
    const anchorError = err as {
      error?: { errorCode?: { code?: string; number?: number } };
      message?: string;
      logs?: string[];
    };
    const errorCode = anchorError.error?.errorCode;
    const message = anchorError.message ?? "";
    const logs = (anchorError.logs ?? []).join("\n");
    const hexCode = `0x${expectedCode.toString(16)}`;

    return (
      errorCode?.code === expectedName ||
      errorCode?.number === expectedCode ||
      message.includes(expectedName) ||
      message.includes(expectedCode.toString()) ||
      message.includes(hexCode) ||
      logs.includes(expectedName) ||
      logs.includes(expectedCode.toString()) ||
      logs.includes(hexCode)
    );
  }

  function alreadyInUseMatches(err: unknown): boolean {
    const sendError = err as {
      message?: string;
      logs?: string[];
    };
    const message = sendError.message ?? "";
    const logs = (sendError.logs ?? []).join("\n");
    const combined = `${message}\n${logs}`.toLowerCase();

    return (
      combined.includes("already in use") ||
      combined.includes("account already exists") ||
      combined.includes("custom program error: 0x0")
    );
  }

  async function expectAnchorError(
    action: () => Promise<unknown>,
    expectedName: string,
    expectedCode: number
  ): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected ${expectedName} rejection: ${String(err)}`);
    }

    expect(caught, `expected ${expectedName} to be thrown`).to.not.equal(
      undefined
    );
    expect(
      errorMatches(caught, expectedName, expectedCode),
      `expected ${expectedName} (${expectedCode}), got ${String(caught)}`
    ).to.equal(true);
  }

  async function expectAlreadyInUse(
    action: () => Promise<unknown>
  ): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected account-already-in-use rejection: ${String(err)}`);
    }

    expect(caught, "expected account-already-in-use rejection").to.not.equal(
      undefined
    );
    expect(
      alreadyInUseMatches(caught),
      `expected account already in use error, got ${String(caught)}`
    ).to.equal(true);
  }

  async function expectRejected(action: () => Promise<unknown>): Promise<void> {
    let rejected = false;

    try {
      await action();
    } catch (err) {
      rejected = true;
      console.log(`Expected rejection: ${String(err)}`);
    }

    expect(rejected).to.equal(true);
  }

  async function expectAccountClosed(account: PublicKey): Promise<void> {
    const info = await connection.getAccountInfo(account, "confirmed");
    expect(info).to.equal(null);
  }

  // claim_handle validation rejects malformed or reserved names before persistence.
  describe("claim_handle - validation", function () {
    async function expectInvalidClaim(
      name: string,
      expectedName: string,
      expectedCode: number
    ): Promise<void> {
      const claimer = await createFundedKeypair(SMALL_WALLET_FUNDING);
      const fixture = createClaimFixture(claimer, name);

      await expectAnchorError(
        () => claimHandle(fixture, `Invalid claim '${name}'`),
        expectedName,
        expectedCode
      );
    }

    it("rejects handles shorter than 3 chars", async function () {
      await expectInvalidClaim("ab", "TooShort", 6000);
    });

    it("rejects handles longer than 20 chars", async function () {
      await expectInvalidClaim("abcdefghijklmnopqrstu", "TooLong", 6001);
    });

    it("rejects uppercase characters", async function () {
      await expectInvalidClaim("Kay", "InvalidCharacters", 6002);
    });

    it("rejects hyphens and special chars", async function () {
      await expectInvalidClaim("ka-y", "InvalidCharacters", 6002);
    });

    it("rejects handles starting with a digit", async function () {
      await expectInvalidClaim("1abc", "StartsWithDigit", 6003);
    });

    it("rejects each reserved word", async function () {
      for (const reserved of [
        "stede",
        "admin",
        "team",
        "support",
        "null",
        "system",
      ]) {
        await expectInvalidClaim(reserved, "Reserved", 6004);
      }
    });
  });

  // claim_handle creates forward and reverse PDAs and stores the anti-squat deposit.
  describe("claim_handle - happy path", function () {
    it("claims a handle and creates both PDAs", async function () {
      const claimer = await createFundedKeypair();
      const name = randomHandle("kay_test_");
      happyPathFixture = createClaimFixture(claimer, name);

      await claimHandle(happyPathFixture);

      const handle = await fetchHandle(happyPathFixture.handlePda);
      const reverse = await fetchReverse(happyPathFixture.reversePda);
      const handleInfo = await connection.getAccountInfo(
        happyPathFixture.handlePda,
        "confirmed"
      );

      expect(handle.owner.equals(claimer.publicKey)).to.equal(true);
      expect(handle.name).to.equal(name);
      expect(handle.claimedAt.gt(new BN(0))).to.equal(true);
      expect(handle.bump).to.be.greaterThan(0);
      expect(reverse.handle).to.equal(name);
      expect(handleInfo).to.not.equal(null);
      expect(handleInfo!.lamports).to.be.greaterThanOrEqual(ANTI_SQUAT_DEPOSIT);
    });

    it("cannot claim the same handle twice", async function () {
      const newClaimer = await createFundedKeypair();
      const duplicateFixture = createClaimFixture(
        newClaimer,
        happyPathFixture.name
      );

      await expectAlreadyInUse(() =>
        claimHandle(duplicateFixture, "Claim duplicate handle")
      );
    });

    it("cannot claim a second handle from the same wallet", async function () {
      const secondFixture = createClaimFixture(
        happyPathFixture.claimer,
        randomHandle("kay_two_")
      );

      await expectAlreadyInUse(() =>
        claimHandle(secondFixture, "Claim second handle from same wallet")
      );
    });
  });

  // release_handle closes both PDAs and refunds rent plus deposit to the owner.
  describe("release_handle", function () {
    it("releases a handle and closes both PDAs", async function () {
      const fixture = await claimFreshHandle("rel_test_");
      const balanceBefore = await connection.getBalance(
        fixture.claimer.publicKey,
        "confirmed"
      );

      await releaseHandle(fixture);

      const balanceAfter = await connection.getBalance(
        fixture.claimer.publicKey,
        "confirmed"
      );
      await expectAccountClosed(fixture.handlePda);
      await expectAccountClosed(fixture.reversePda);
      expect(balanceAfter).to.be.greaterThan(balanceBefore);
    });

    it("only the owner can release a handle", async function () {
      const fixture = await claimFreshHandle("own_test_");
      const nonOwner = await createFundedKeypair(SMALL_WALLET_FUNDING);

      await expectRejected(() =>
        releaseHandle(fixture, nonOwner, "Release as non-owner")
      );
    });
  });

  // transfer_handle moves ownership and rewrites the wallet-to-handle reverse PDA.
  describe("transfer_handle", function () {
    it("transfers a handle to a new wallet, updating all PDAs", async function () {
      const fixture = await claimFreshHandle("alice_test_");
      const bob = await createFundedKeypair(SMALL_WALLET_FUNDING);
      const bobReversePda = deriveReversePda(bob.publicKey);

      await transferHandle(fixture, fixture.claimer, bob);

      const handle = await fetchHandle(fixture.handlePda);
      const bobReverse = await fetchReverse(bobReversePda);

      expect(handle.owner.equals(bob.publicKey)).to.equal(true);
      expect(handle.name).to.equal(fixture.name);
      await expectAccountClosed(fixture.reversePda);
      expect(bobReverse.handle).to.equal(fixture.name);
    });

    it("rejects transfer when current_owner doesn't own the handle", async function () {
      const fixture = await claimFreshHandle("alice_test_");
      const bob = await createFundedKeypair(SMALL_WALLET_FUNDING);
      const newOwner = await createFundedKeypair(SMALL_WALLET_FUNDING);

      await expectRejected(() =>
        transferHandle(fixture, bob, newOwner, "Transfer by non-owner")
      );
    });

    it("rejects transfer when new_owner already has a handle", async function () {
      const aliceFixture = await claimFreshHandle("alice_test_");
      const charlieFixture = await claimFreshHandle("charlie_");

      await expectAlreadyInUse(() =>
        transferHandle(
          aliceFixture,
          aliceFixture.claimer,
          charlieFixture.claimer,
          "Transfer to wallet with existing handle"
        )
      );
    });
  });
});
