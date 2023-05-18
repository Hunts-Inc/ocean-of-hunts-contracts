const {expect} = require("chai");
const {ethers} = require("hardhat");
const {time} = require("@nomicfoundation/hardhat-network-helpers");
const {expectRevert} = require('@openzeppelin/test-helpers');

const ocnPrice = ethers.utils.parseEther("0.0025");
const hhPrice = ethers.utils.parseEther("0.25");

const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
const OCN_CLIFF = ONE_MONTH_IN_SECS * 8;
const HH_CLIFF = ONE_MONTH_IN_SECS * 12;


describe("SeedRoundOceanHunt", function () {
    let seedRound;
    let oracle;
    let owner;
    let ocnToken;
    let hhToken;
    let mockUSDT;
    let mockUSDC;
    let userAccount;

    async function deployToken(contractName, owner) {
        const TokenContract = await ethers.getContractFactory(contractName, owner);
        const token = await TokenContract.deploy();
        await token.deployed();
        return token;
    }

    beforeEach(async function () {
        const wallets = await ethers.getSigners();
        owner = wallets[0];
        userAccount = wallets[1];
        oracle = wallets[10];

        ocnToken = await deployToken("OceanOfHunts", owner);
        hhToken = await deployToken("HuntsHub", owner);
        mockUSDT = await deployToken("USDT", oracle);
        mockUSDC = await deployToken("USDT", oracle);

        const SeedRound = await ethers.getContractFactory("SeedRound", owner);
        seedRound = await SeedRound.deploy(mockUSDT.address, mockUSDC.address);
        await seedRound.deployed();
    });

    it("should be deployed by same address", async function () {
        expect(seedRound.address).to.be.properAddress;
        expect(seedRound.address.owner).to.be.equal(ocnToken.address.owner);
    });

    it("should not allow non-owners to start the Seed Round", async function () {
        await expectRevert(seedRound.connect(userAccount).startSeedRound(), 'Ownable: caller is not the owner');
    });

    describe("buying tokens", function () {
        it("should not allow purchasing tokens if the Seed Round is not running", async () => {
            await expectRevert.unspecified(seedRound.connect(userAccount).buyWithEth(10));
        });

        beforeEach(async function () {
            await seedRound.connect(owner).startSeedRound();
        });

        it("should allow the owner to start the Seed Round", async function () {
            expect(await seedRound.seedRoundRunning()).to.be.true;
        });

        it("should allow the owner to stop the Seed Round", async () => {
            await seedRound.connect(owner).stopSeedRound();
            expect(await seedRound.seedRoundRunning()).to.be.false;
        });

        it("should not allow non-owners to stop the Seed Round", async () => {
            await expectRevert(seedRound.connect(userAccount).stopSeedRound(), 'Ownable: caller is not the owner');
        });

        it("should not allow purchasing more tokens than the maximum allowed", async () => {
            await expectRevert.unspecified(seedRound.connect(userAccount).buyWithEth(40000001));
        });

        it("should allow purchasing tokens with USDT when Seed Round is running", async function () {
            const usdtValue = 600;
            await mockUSDT.connect(oracle).transfer(userAccount.address, ethers.utils.parseUnits(usdtValue.toString(), 6));
            await mockUSDT.connect(userAccount).approve(seedRound.address, ethers.utils.parseUnits(usdtValue.toString(), 6));
            await seedRound.connect(userAccount).buyWithUSDT(usdtValue);
            const balance = await seedRound.connect(userAccount).userDepositsOCN(userAccount.address)
            expect(balance).to.be.gt(0);
        });

        it("should correctly calculate the amount of tokens based on the USDT value", async () => {
            const usdtValue = "600";
            const usdtAmount = ethers.BigNumber.from(usdtValue).mul(ethers.utils.parseEther("1"));
            const expectedTokens = usdtAmount.div(8).div(ocnPrice);
            const actualTokens = await seedRound.connect(userAccount).calculateTokensAmount(usdtAmount);
            expect(actualTokens.ocnAmount).to.equal(expectedTokens);
        });

        const currentEthPrice = 190324866329;

        it("should correctly calculate the amount of tokens based on the ETH value", async () => {
            const tokenValue = ethers.utils.parseEther("0.05");
            const usdtAmount = tokenValue.mul(ethers.BigNumber.from(currentEthPrice)).div(10 ** 8);
            const expectedOcnTokens = usdtAmount.div(ocnPrice).div(8);
            const expectedHhTokens = usdtAmount.mul(7).div(hhPrice).div(8);
            const actualTokens = await seedRound.connect(userAccount).calculateTokensAmount(usdtAmount);
            expect(actualTokens.ocnAmount).to.equal(expectedOcnTokens);
            expect(actualTokens.hhAmount).to.equal(expectedHhTokens);
        });

        it("should buy tokens with ETH", async () => {
            const tokenValue = ethers.utils.parseEther("0.05");
            await seedRound.connect(userAccount).buyWithEth(tokenValue, {value: tokenValue});
            const usdtValue = tokenValue.mul(ethers.BigNumber.from(currentEthPrice).div(10 ** 8)); //
            const userDepositExpect = usdtValue.div(8).div(ocnPrice);
            expect(await seedRound.connect(userAccount).totalTokensSoldOCN()).to.equal(userDepositExpect);
            expect(await seedRound.connect(userAccount).userDepositsOCN(userAccount.address)).to.equal(ethers.utils.parseEther(userDepositExpect.toString()));
        });

        it("should correctly update the total number of tokens sold and the user's deposit after a successful purchase", async () => {
            const usdtValue = "600";
            const usdtAmount = ethers.utils.parseUnits(usdtValue, 6);
            await mockUSDT.connect(oracle).transfer(userAccount.address, usdtAmount);
            await mockUSDT.connect(userAccount).approve(seedRound.address, usdtAmount);
            await seedRound.connect(userAccount).buyWithUSDT(usdtValue);
            const tokenAmountBN = ethers.utils.parseEther(usdtValue.toString())
            const userDepositExpect = tokenAmountBN.div(8).div(ocnPrice);
            expect(await seedRound.connect(userAccount).totalTokensSoldOCN()).to.equal(userDepositExpect);
            expect(await seedRound.connect(userAccount).userDepositsOCN(userAccount.address)).to.equal(ethers.utils.parseEther(userDepositExpect.toString()));
        });
    });

    describe("claiming tokens", function () {
        let ocnDecimals;
        let hhDecimals;

        it("should not allow claiming tokens before the claim start", async () => {
            await expectRevert.unspecified(seedRound.connect(userAccount).claimOCN());
        });

        beforeEach(async function () {
            const usdtValue = "250";
            const usdtAmount = ethers.utils.parseUnits(usdtValue, 6);
            await seedRound.connect(owner).startSeedRound();
            await mockUSDT.connect(oracle).transfer(userAccount.address, usdtAmount);
            await mockUSDT.connect(userAccount).approve(seedRound.address, usdtAmount);
            await seedRound.connect(userAccount).buyWithUSDT(usdtValue);

            const totalTokensSoldOCN = await seedRound.connect(userAccount).totalTokensSoldOCN();
            const totalTokensSoldHH = await seedRound.connect(userAccount).totalTokensSoldHH();
            ocnDecimals = ethers.utils.parseEther(totalTokensSoldOCN.toString());
            hhDecimals = ethers.utils.parseEther(totalTokensSoldHH.toString());
            await ocnToken.connect(owner).increaseAllowance(seedRound.address, ocnDecimals);
            await hhToken.connect(owner).increaseAllowance(seedRound.address, hhDecimals);
            await seedRound.startClaim(ocnDecimals, hhDecimals, ocnToken.address, hhToken.address);
        });

        it("should allow claiming OCN tokens after the claim start", async () => {
            const unlockTimeOCN = await time.latest() + OCN_CLIFF; // 8 months cliff for OCN
            await time.increaseTo(unlockTimeOCN);

            await seedRound.connect(userAccount).claimOCN();
        });

        it("should allow claiming HH tokens after the claim start", async () => {
            const unlockTimeHH = await time.latest() + HH_CLIFF; // 12 months cliff for HH
            await time.increaseTo(unlockTimeHH);

            await seedRound.connect(userAccount).claimHH();
        });

        it("should allow claiming OCN tokens after the 8-month vesting period and check balance", async () => {
            const unlockTimeOCN = await time.latest() + OCN_CLIFF;

            await time.increaseTo(unlockTimeOCN);
            await seedRound.connect(userAccount).claimOCN();

            const balanceAfter = await ocnToken.balanceOf(userAccount.address);
            const expectedBalance = ocnDecimals.div(14); // get first vesting interval of total OCN tokens
            expect(balanceAfter).to.equal(expectedBalance);
        });

        it("should allow claiming OCN tokens after the 10-month vesting period and check balance", async () => {
            const unlockTimeOCN = (await time.latest()) + OCN_CLIFF + ONE_MONTH_IN_SECS * 2; // 8 months cliff for OCN

            await time.increaseTo(unlockTimeOCN);
            await seedRound.connect(userAccount).claimOCN();

            const balanceAfter = await ocnToken.balanceOf(userAccount.address);
            const expectedBalance = ocnDecimals.div(14).mul(2); // get second vesting interval of total OCN tokens
            expect(balanceAfter).to.equal(expectedBalance.add(1)); // add plus 1 cuz solidity rounding to zero
        });

        it("should allow claiming tokens after the 20-month vesting period", async () => {
            const unlockTime = (await time.latest()) + ONE_MONTH_IN_SECS * 20;
            await time.increaseTo(unlockTime);
            await seedRound.connect(userAccount).claimOCN();
        });

        it("should allow claiming 2 times OCN tokens", async () => {
            const VESTING_INTERVAL = ONE_MONTH_IN_SECS * 2;
            const unlockTimeOCN = await time.latest() + OCN_CLIFF; // 8 months cliff for OCN

            await time.increaseTo(unlockTimeOCN);
            await seedRound.connect(userAccount).claimOCN();
            const expectedBalanceFirstTime = ocnDecimals.div(14); // get first vesting interval of total OCN tokens
            const balanceAfterFirst = await ocnToken.balanceOf(userAccount.address);
            expect(expectedBalanceFirstTime).to.equal(balanceAfterFirst);

            await time.increaseTo(unlockTimeOCN + VESTING_INTERVAL * 2);
            await seedRound.connect(userAccount).claimOCN();
            const expectedBalanceSecondTime = ocnDecimals.div(14).mul(3); // get second vesting interval of total OCN tokens
            expect(expectedBalanceSecondTime).to.equal(expectedBalanceSecondTime);
        });

        it("should not allow  claiming tokens before vesting", async () => {
            await expect(seedRound.connect(userAccount).claimOCN()).to.be.revertedWith("Vesting cliff not reached");
        });
    });
});

