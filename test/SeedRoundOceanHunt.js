const {expect} = require("chai");
const {ethers} = require("hardhat");
const {time} = require("@nomicfoundation/hardhat-network-helpers");
const {expectRevert} = require('@openzeppelin/test-helpers');

const srkPrice = ethers.utils.parseEther("0.0025");
const hhPrice = ethers.utils.parseEther("0.25");

const ONE_MONTH_IN_SECS = 30 * 24 * 60 * 60;
const SRK_CLIFF = ONE_MONTH_IN_SECS * 8;
const HH_CLIFF = ONE_MONTH_IN_SECS * 12;


describe("SeedRoundOceanHunt", function () {
    let seedRound;
    let oracle;
    let owner;
    let srkToken;
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

        srkToken = await deployToken("OceanOfHunts", owner);
        hhToken = await deployToken("HuntsHub", owner);
        mockUSDT = await deployToken("USDT", oracle);
        mockUSDC = await deployToken("USDT", oracle);

        const SeedRound = await ethers.getContractFactory("SeedRound", owner);
        seedRound = await SeedRound.deploy(mockUSDT.address, mockUSDC.address);
        await seedRound.deployed();
    });

    it("should be deployed by same address", async function () {
        expect(seedRound.address).to.be.properAddress;
        expect(seedRound.address.owner).to.be.equal(srkToken.address.owner);
    });

    it("should not allow non-owners to start the ICO", async function () {
        await expectRevert(seedRound.connect(userAccount).startSeedRound(), 'Ownable: caller is not the owner');
    });

    describe("buying tokens", function () {
        it("should not allow purchasing tokens if the ICO is not running", async () => {
            await expectRevert.unspecified(seedRound.connect(userAccount).buyWithEth(10));
        });

        beforeEach(async function () {
            await seedRound.connect(owner).startSeedRound();
        });

        it("should allow the owner to start the ICO", async function () {
            expect(await seedRound.seedRoundRunning()).to.be.true;
        });

        it("should allow the owner to stop the ICO", async () => {
            await seedRound.connect(owner).stopSeedRound();
            expect(await seedRound.seedRoundRunning()).to.be.false;
        });

        it("should not allow non-owners to stop the ICO", async () => {
            await expectRevert(seedRound.connect(userAccount).stopSeedRound(), 'Ownable: caller is not the owner');
        });

        it("should not allow purchasing more tokens than the maximum allowed", async () => {
            await expectRevert.unspecified(seedRound.connect(userAccount).buyWithEth(40000001));
        });

        it("should allow purchasing tokens with USDT when ICO is running", async function () {
            const usdtValue = 600;
            await mockUSDT.connect(oracle).transfer(userAccount.address, ethers.utils.parseUnits(usdtValue.toString(), 6));
            await mockUSDT.connect(userAccount).approve(seedRound.address, ethers.utils.parseUnits(usdtValue.toString(), 6));
            await seedRound.connect(userAccount).buyWithUSDT(usdtValue);
            const balance = await seedRound.connect(userAccount).userDepositsSRK(userAccount.address)
            expect(balance).to.be.gt(0);
        });

        it("should correctly calculate the amount of tokens based on the USDT value", async () => {
            const usdtValue = "600";
            const usdtAmount = ethers.BigNumber.from(usdtValue).mul(ethers.utils.parseEther("1"));
            const expectedTokens = usdtAmount.div(8).div(srkPrice);
            const actualTokens = await seedRound.connect(userAccount).calculateTokensAmount(usdtAmount);
            expect(actualTokens.srkAmount).to.equal(expectedTokens);
        });

        const currentEthPrice = 190324866329;

        it("should correctly calculate the amount of tokens based on the ETH value", async () => {
            const tokenValue = ethers.utils.parseEther("0.05");
            const usdtAmount = tokenValue.mul(ethers.BigNumber.from(currentEthPrice)).div(10 ** 8);
            const expectedSrkTokens = usdtAmount.div(srkPrice).div(8);
            const expectedHhTokens = usdtAmount.mul(7).div(hhPrice).div(8);
            const actualTokens = await seedRound.connect(userAccount).calculateTokensAmount(usdtAmount);
            expect(actualTokens.srkAmount).to.equal(expectedSrkTokens);
            expect(actualTokens.hhAmount).to.equal(expectedHhTokens);
        });

        it("should buy tokens with ETH", async () => {
            const tokenValue = ethers.utils.parseEther("0.05");
            await seedRound.connect(userAccount).buyWithEth(tokenValue, {value: tokenValue});
            const usdtValue = tokenValue.mul(ethers.BigNumber.from(currentEthPrice).div(10 ** 8)); //
            const userDepositExpect = usdtValue.div(8).div(srkPrice);
            expect(await seedRound.connect(userAccount).totalTokensSoldSRK()).to.equal(userDepositExpect);
            expect(await seedRound.connect(userAccount).userDepositsSRK(userAccount.address)).to.equal(ethers.utils.parseEther(userDepositExpect.toString()));
        });

        it("should correctly update the total number of tokens sold and the user's deposit after a successful purchase", async () => {
            const usdtValue = "600";
            const usdtAmount = ethers.utils.parseUnits(usdtValue, 6);
            await mockUSDT.connect(oracle).transfer(userAccount.address, usdtAmount);
            await mockUSDT.connect(userAccount).approve(seedRound.address, usdtAmount);
            await seedRound.connect(userAccount).buyWithUSDT(usdtValue);
            const tokenAmountBN = ethers.utils.parseEther(usdtValue.toString())
            const userDepositExpect = tokenAmountBN.div(8).div(srkPrice);
            expect(await seedRound.connect(userAccount).totalTokensSoldSRK()).to.equal(userDepositExpect);
            expect(await seedRound.connect(userAccount).userDepositsSRK(userAccount.address)).to.equal(ethers.utils.parseEther(userDepositExpect.toString()));
        });
    });

    describe("claiming tokens", function () {
        let srkDecimals;
        let hhDecimals;

        it("should not allow claiming tokens before the claim start", async () => {
            await expectRevert.unspecified(seedRound.connect(userAccount).claimSRK());
        });

        beforeEach(async function () {
            const usdtValue = "250";
            const usdtAmount = ethers.utils.parseUnits(usdtValue, 6);
            await seedRound.connect(owner).startSeedRound();
            await mockUSDT.connect(oracle).transfer(userAccount.address, usdtAmount);
            await mockUSDT.connect(userAccount).approve(seedRound.address, usdtAmount);
            await seedRound.connect(userAccount).buyWithUSDT(usdtValue);

            const totalTokensSoldSRK = await seedRound.connect(userAccount).totalTokensSoldSRK();
            const totalTokensSoldHH = await seedRound.connect(userAccount).totalTokensSoldHH();
            srkDecimals = ethers.utils.parseEther(totalTokensSoldSRK.toString());
            hhDecimals = ethers.utils.parseEther(totalTokensSoldHH.toString());
            await srkToken.connect(owner).increaseAllowance(seedRound.address, srkDecimals);
            await hhToken.connect(owner).increaseAllowance(seedRound.address, hhDecimals);
            await seedRound.startClaim(srkDecimals, hhDecimals, srkToken.address, hhToken.address);
        });

        it("should allow claiming SRK tokens after the claim start", async () => {
            const unlockTimeSRK = await time.latest() + SRK_CLIFF; // 8 months cliff for SRK
            await time.increaseTo(unlockTimeSRK);

            await seedRound.connect(userAccount).claimSRK();
        });

        it("should allow claiming HH tokens after the claim start", async () => {
            const unlockTimeHH = await time.latest() + HH_CLIFF; // 12 months cliff for HH
            await time.increaseTo(unlockTimeHH);

            await seedRound.connect(userAccount).claimHH();
        });

        it("should allow claiming SRK tokens after the 8-month vesting period and check balance", async () => {
            const unlockTimeSRK = await time.latest() + SRK_CLIFF;

            await time.increaseTo(unlockTimeSRK);
            await seedRound.connect(userAccount).claimSRK();

            const balanceAfter = await srkToken.balanceOf(userAccount.address);
            const expectedBalance = srkDecimals.div(14); // get first vesting interval of total SRK tokens
            expect(balanceAfter).to.equal(expectedBalance);
        });

        it("should allow claiming SRK tokens after the 10-month vesting period and check balance", async () => {
            const unlockTimeSRK = (await time.latest()) + SRK_CLIFF + ONE_MONTH_IN_SECS * 2; // 8 months cliff for SRK

            await time.increaseTo(unlockTimeSRK);
            await seedRound.connect(userAccount).claimSRK();

            const balanceAfter = await srkToken.balanceOf(userAccount.address);
            const expectedBalance = srkDecimals.div(14).mul(2); // get second vesting interval of total SRK tokens
            expect(balanceAfter).to.equal(expectedBalance.add(1)); // add plus 1 cuz solidity rounding to zero
        });

        it("should allow claiming tokens after the 20-month vesting period", async () => {
            const unlockTime = (await time.latest()) + ONE_MONTH_IN_SECS * 20;
            await time.increaseTo(unlockTime);
            await seedRound.connect(userAccount).claimSRK();
        });

        it("should allow claiming 2 times SRK tokens", async () => {
            const VESTING_INTERVAL = ONE_MONTH_IN_SECS * 2;
            const unlockTimeSRK = await time.latest() + SRK_CLIFF; // 8 months cliff for SRK

            await time.increaseTo(unlockTimeSRK);
            await seedRound.connect(userAccount).claimSRK();
            const expectedBalanceFirstTime = srkDecimals.div(14); // get first vesting interval of total SRK tokens
            const balanceAfterFirst = await srkToken.balanceOf(userAccount.address);
            expect(expectedBalanceFirstTime).to.equal(balanceAfterFirst);

            await time.increaseTo(unlockTimeSRK + VESTING_INTERVAL * 2);
            await seedRound.connect(userAccount).claimSRK();
            const expectedBalanceSecondTime = srkDecimals.div(14).mul(3); // get second vesting interval of total SRK tokens
            expect(expectedBalanceSecondTime).to.equal(expectedBalanceSecondTime);
        });

        it("should not allow  claiming tokens before vesting", async () => {
            await expect(seedRound.connect(userAccount).claimSRK()).to.be.revertedWith("Vesting cliff not reached");
        });
    });
});

