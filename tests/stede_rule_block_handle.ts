import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const BLOCK_HANDLE_PROGRAM_ID = new PublicKey(
  "J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq"
);
const BLOCK_HANDLE_SEED = "rule_block_handle";

type BlockListAccount = {
  sender: PublicKey;
  stedeMint: PublicKey;
  blocked: PublicKey[];
  count: number;
  bump: number;
};

type BlockListFixture = {
  stedeMint: PublicKey;
  blockList: PublicKey;
};

describe("stede_rule_block_handle", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;

  before(async function () {
    program = await Program.at(BLOCK_HANDLE_PROGRAM_ID.toBase58(), provider);
  });

  function deriveBlockList(sender: PublicKey, stedeMint: PublicKey): PublicKey {
    const [blockList] = PublicKey.findProgramAddressSync(
      [Buffer.from(BLOCK_HANDLE_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      BLOCK_HANDLE_PROGRAM_ID
    );
    return blockList;
  }

  function createFixture(): BlockListFixture {
    const stedeMint = Keypair.generate().publicKey;
    return {
      stedeMint,
      blockList: deriveBlockList(payer.publicKey, stedeMint),
    };
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function addBlocked(
    fixture: BlockListFixture,
    blockedWallet: PublicKey,
    label = "Add blocked wallet"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .addBlocked(blockedWallet)
      .accounts({
        sender: payer.publicKey,
        stedeMint: fixture.stedeMint,
        blockList: fixture.blockList,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function removeBlocked(
    fixture: BlockListFixture,
    blockedWallet: PublicKey,
    label = "Remove blocked wallet"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .removeBlocked(blockedWallet)
      .accounts({
        sender: payer.publicKey,
        stedeMint: fixture.stedeMint,
        blockList: fixture.blockList,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function checkTransfer(
    fixture: BlockListFixture,
    recipientWallet: PublicKey,
    label = "Check block-list transfer"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .checkTransfer(recipientWallet)
      .accounts({
        blockList: fixture.blockList,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function fetchBlockList(
    fixture: BlockListFixture
  ): Promise<BlockListAccount> {
    return (program.account as any).blockList.fetch(fixture.blockList);
  }

  function expectEmptySlots(
    blocked: PublicKey[],
    startIndex: number,
    endIndex = blocked.length
  ): void {
    for (let index = startIndex; index < endIndex; index += 1) {
      expect(blocked[index].equals(PublicKey.default)).to.equal(true);
    }
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

  // addBlocked creates the sender's block-list PDA and fills empty slots in order.
  describe("addBlocked", function () {
    it("creates a BlockList PDA and adds the first blocked wallet", async function () {
      const fixture = createFixture();
      const target = Keypair.generate().publicKey;

      await addBlocked(fixture, target, "Add first blocked wallet");

      const blockList = await fetchBlockList(fixture);
      expect(blockList.sender.equals(payer.publicKey)).to.equal(true);
      expect(blockList.stedeMint.equals(fixture.stedeMint)).to.equal(true);
      expect(blockList.count).to.equal(1);
      expect(blockList.blocked[0].equals(target)).to.equal(true);
      expectEmptySlots(blockList.blocked, 1);
    });

    it("adds multiple blocked wallets in order", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;
      const walletB = Keypair.generate().publicKey;
      const walletC = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet A");
      await addBlocked(fixture, walletB, "Add wallet B");
      await addBlocked(fixture, walletC, "Add wallet C");

      const blockList = await fetchBlockList(fixture);
      expect(blockList.count).to.equal(3);
      expect(blockList.blocked[0].equals(walletA)).to.equal(true);
      expect(blockList.blocked[1].equals(walletB)).to.equal(true);
      expect(blockList.blocked[2].equals(walletC)).to.equal(true);
      expectEmptySlots(blockList.blocked, 3);
    });

    it("rejects adding a wallet that's already blocked", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet before duplicate");

      await expectAnchorError(
        () => addBlocked(fixture, walletA, "Add duplicate blocked wallet"),
        "AlreadyBlocked",
        6002
      );
    });

    it("rejects the zero address", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () => addBlocked(fixture, PublicKey.default, "Add zero address"),
        "ZeroAddress",
        6004
      );
    });
  });

  // removeBlocked zeroes the removed slot and allows future re-use.
  describe("removeBlocked", function () {
    it("removes a blocked wallet and zeroes its slot", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;
      const walletB = Keypair.generate().publicKey;
      const walletC = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet A before remove");
      await addBlocked(fixture, walletB, "Add wallet B before remove");
      await addBlocked(fixture, walletC, "Add wallet C before remove");
      await removeBlocked(fixture, walletB, "Remove wallet B");

      const blockList = await fetchBlockList(fixture);
      expect(blockList.count).to.equal(2);
      expect(blockList.blocked[0].equals(walletA)).to.equal(true);
      expect(blockList.blocked[1].equals(PublicKey.default)).to.equal(true);
      expect(blockList.blocked[2].equals(walletC)).to.equal(true);
    });

    it("rejects removing a wallet that's not on the list", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;
      const neverAdded = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet before missing remove");

      await expectAnchorError(
        () => removeBlocked(fixture, neverAdded, "Remove missing wallet"),
        "NotBlocked",
        6003
      );
    });

    it("allows re-adding a previously removed wallet", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet before re-add");
      await removeBlocked(fixture, walletA, "Remove wallet before re-add");
      await addBlocked(fixture, walletA, "Re-add removed wallet");

      const blockList = await fetchBlockList(fixture);
      expect(blockList.count).to.equal(1);
      expect(blockList.blocked[0].equals(walletA)).to.equal(true);
      expectEmptySlots(blockList.blocked, 1);
    });
  });

  // checkTransfer allows non-blocked recipients and rejects blocked recipients.
  describe("checkTransfer", function () {
    it("approves a transfer to a non-blocked recipient", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;
      const walletB = Keypair.generate().publicKey;
      const walletC = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet A before allowed check");
      await addBlocked(fixture, walletB, "Add wallet B before allowed check");
      await checkTransfer(fixture, walletC, "Check non-blocked recipient");
    });

    it("rejects a transfer to a blocked recipient", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;
      const walletB = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet A before blocked check");
      await addBlocked(fixture, walletB, "Add wallet B before blocked check");

      await expectAnchorError(
        () => checkTransfer(fixture, walletA, "Check blocked recipient"),
        "RecipientBlocked",
        6000
      );
    });

    it("approves a transfer to the zero address", async function () {
      const fixture = createFixture();
      const walletA = Keypair.generate().publicKey;

      await addBlocked(fixture, walletA, "Add wallet before zero check");
      await checkTransfer(
        fixture,
        PublicKey.default,
        "Check zero-address recipient"
      );
    });
  });
});
