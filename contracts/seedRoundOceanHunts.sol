//SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface Aggregator {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract SeedRound is ReentrancyGuard, Ownable, Pausable {
    uint256 public totalTokensSoldSRK;
    uint256 public totalTokensSoldHH;
    uint256 public claimStartTime;

    address public SRKToken;
    address public HHToken;

    bool public claimStarted;
    bool public seedRoundRunning;

    IERC20 public USDTInterface;
    IERC20 public USDCInterface;
    Aggregator public aggregatorInterface;

    uint256 public SRK_price;
    uint256 public HH_price;

    mapping(address => uint256) public userDepositsSRK;
    mapping(address => uint256) public userDepositsHH;

    mapping(address => uint256) public userLastClaimSRK;
    mapping(address => uint256) public userLastClaimHH;

    uint256 constant public maxTotalSRKTokensSold = 200000000;
    uint256 constant public minLimitUsdToBuy = 10;
    uint256 constant public maxLimitUsdToBuy = 5000;

    uint256 public constant VESTING_INTERVAL = 60 days;
    uint256 public constant CLIFF_DURATION_SRK = 6 * 30 days; // + 2 months vesting = 8 months
    uint256 public constant VESTING_DURATION_SRK = 28 * 30 days; // 28 months

    uint256 public constant CLIFF_DURATION_HH = 10 * 30 days; // + 2 months vesting = 12 months
    uint256 public constant VESTING_DURATION_HH = 60 * 30 days; // 60 months

    event TokensBought(address indexed user, uint256 indexed tokensBoughtSRK, uint256 indexed tokensBoughtHH, uint256 amountPaid, uint256 usdEq, uint256 timestamp);
    event TokensAdded(uint256 indexed SRKnoOfTokens, uint256 indexed HHnoOfTokens, address _SRKToken, address _HHToken, uint256 timestamp);
    event TokensClaimedSRK(address indexed user, uint256 amount, uint256 timestamp);
    event TokensClaimedHH(address indexed user, uint256 amount, uint256 timestamp);

    /**
     * @dev Initializes the contract and sets key parameters
     * @param _usdt USDT token contract address
     * @param _usdc USDC token contract address
     */
    constructor(address _usdt, address _usdc) {
        require(_usdt != address(0), "Zero USDT address");
        require(_usdc != address(0), "Zero USDC address");
        SRK_price = 2500000000000000;   // 0.0025 USD
        HH_price = 250000000000000000;   // 0.25 USD
        aggregatorInterface = Aggregator(0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e); // Oracle contract to fetch ETH/USDT price test net
        USDTInterface = IERC20(_usdt);
        USDCInterface = IERC20(_usdc);
    }

    /**
     * @dev Calculate the amount of SRK and HH tokens for a given amount of USD.
     * @param usdAmount Amount of USDT to spend on tokens
     */
    function calculateTokensAmount(uint256 usdAmount) public view returns (uint256 srkAmount, uint256 hhAmount) {
        uint256 totalSRKValue = usdAmount / 8;
        uint256 totalHHValue = (usdAmount * 7) / 8;
        srkAmount = totalSRKValue / SRK_price;
        hhAmount = totalHHValue / HH_price;
        require(srkAmount + totalTokensSoldSRK <= maxTotalSRKTokensSold, "Reached the limit of tokens to be sold");
    }

    /**
     * @dev  Starts the Seed Round.
     */
    function startSeedRound() public onlyOwner returns(bool){
        seedRoundRunning = true;
        return true;
    }

    /**
     * @dev  Stop the Seed Round.
     */
    function stopSeedRound() public onlyOwner returns(bool){
        seedRoundRunning = false;
        return true;
    }

    /**
     * @dev To get latest ETH price in 10**18 format
     */
    function getLatestEthPrice() public view returns (uint256) {
        (, int256 price, , , ) = aggregatorInterface.latestRoundData();
        price = (price / (10**8));
        return uint256(price);
    }


    modifier checkSaleState(uint256 usdAmount) {
        require(seedRoundRunning, "Seed Round not running");
        require(usdAmount <= maxLimitUsdToBuy, "Amount exceeds max tokens to buy");
        require(usdAmount >= minLimitUsdToBuy, "Amount of tokens too small to buy");
        _;
    }

    /**
     * @dev To buy into a presale using USDT
     * @param usdAmount The amount of USDT the user wants to spend to buy tokens
     */
    function buyWithUSDT(uint256 usdAmount) external checkSaleState(usdAmount) whenNotPaused returns (bool) {
        (uint256 srkAmount, uint256 hhAmount) = calculateTokensAmount(usdAmount*(10**baseDecimals()));
        uint256 ourAllowance = USDTInterface.allowance(
            _msgSender(),
            address(this)
        );

        require(usdAmount <= ourAllowance, "Make sure to add enough allowance");
        (bool success, ) = address(USDTInterface).call(
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                _msgSender(),
                owner(),
                usdAmount *(10 * stableCoinsDecimals())
            )
        );
        require(success, "Token payment failed");

        totalTokensSoldSRK += srkAmount;
        totalTokensSoldHH += hhAmount;

        userDepositsSRK[_msgSender()] += srkAmount * (10**baseDecimals());
        userDepositsHH[_msgSender()] += hhAmount * (10**baseDecimals());
        emit TokensBought(
            _msgSender(),
            srkAmount,
            hhAmount,
            usdAmount,
            usdAmount,
            block.timestamp
        );
        return true;
    }

    /**
     * @dev To buy into a presale using USDC
     * @param usdAmount The amount of USDC the user wants to spend to buy tokens
     */
    function buyWithUSDC(uint256 usdAmount) external checkSaleState(usdAmount) whenNotPaused returns (bool) {
        (uint256 srkAmount, uint256 hhAmount) = calculateTokensAmount(usdAmount*(10**baseDecimals()));
        uint256 ourAllowance = USDCInterface.allowance(
            _msgSender(),
            address(this)
        );
        require(usdAmount <= ourAllowance, "Make sure to add enough allowance");
        (bool success, ) = address(USDCInterface).call(
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                _msgSender(),
                owner(),
                usdAmount *(10 * stableCoinsDecimals())
            )
        );
        require(success, "Token payment failed");

        totalTokensSoldSRK += srkAmount;
        totalTokensSoldHH += hhAmount;
        userDepositsSRK[_msgSender()] += srkAmount * (10**baseDecimals());
        userDepositsHH[_msgSender()] += hhAmount * (10**baseDecimals());
        emit TokensBought(
            _msgSender(),
            srkAmount,
            hhAmount,
            usdAmount,
            usdAmount,
            block.timestamp
        );
        return true;
    }

    /**
     * @dev To buy into a presale using ETH
     * @param ethAmount No of tokens to buy
     */
    function buyWithEth(uint256 ethAmount) external payable checkSaleState(ethAmount * getLatestEthPrice() / (10**18))
        whenNotPaused nonReentrant returns (bool){
        uint256 usdAmount = ethAmount * getLatestEthPrice();
        (uint256 srkAmount, uint256 hhAmount) = calculateTokensAmount(usdAmount);
        require(msg.value >= ethAmount, "Less payment");
        uint256 excess = msg.value - ethAmount;

        totalTokensSoldSRK += srkAmount;
        totalTokensSoldHH += hhAmount;
        userDepositsSRK[_msgSender()] += srkAmount * (10**baseDecimals());
        userDepositsHH[_msgSender()] += hhAmount * (10**baseDecimals());

        sendValue(payable(owner()), ethAmount);
        if (excess > 0) sendValue(payable(_msgSender()), excess);
        emit TokensBought(
            _msgSender(),
            srkAmount,
            hhAmount,
            ethAmount,
            usdAmount,
            block.timestamp
        );
        return true;
    }


    function sendValue(address payable recipient, uint256 amount) internal {
        require(address(this).balance >= amount, "Low balance");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH Payment failed");
    }

    /**
     * @dev To set the SRK and HH token addresses and transfer tokens for claiming by the owner
     * @param SRKnoOfTokens number of SRK tokens to add to the contract
     * @param HHnoOfTokens number of HH tokens to add to the contract
     * @param _SRKToken SRK token address
     * @param _HHToken HH token address
     */
    function startClaim(uint256 SRKnoOfTokens, uint256 HHnoOfTokens, address _SRKToken, address _HHToken)
        external onlyOwner returns (bool) {
        require(
            SRKnoOfTokens >= (totalTokensSoldSRK * (10**baseDecimals())) &&
            HHnoOfTokens >= (totalTokensSoldHH * (10**baseDecimals())),
            "Tokens less than sold"
        );
        require(_SRKToken != address(0), "SRK zero token address");
        require(_HHToken != address(0), "HH Zero token address");
        require(!claimStarted, "Claim already set");

        bool SRKtransfer = IERC20(_SRKToken).transferFrom(
            _msgSender(),
            address(this),
            SRKnoOfTokens
        );
        require(SRKtransfer, "SRK transfer failed");
        bool HHtransfer = IERC20(_HHToken).transferFrom(
            _msgSender(),
            address(this),
            HHnoOfTokens
        );
        require(HHtransfer, "HH transfer failed");

        SRKToken = _SRKToken;
        HHToken = _HHToken;

        claimStarted = true;
        claimStartTime = block.timestamp;

        emit TokensAdded(SRKnoOfTokens, HHnoOfTokens, _SRKToken, _HHToken, block.timestamp);
        return true;
    }

    /**
     * @dev To claim SRK tokens after claiming starts
     */
    function claimSRK() external nonReentrant whenNotPaused returns (bool) {
        require(SRKToken != address(0), "SRK token not added");
        require(claimStarted, "Claim has not started yet");

        uint256 amount = userDepositsSRK[_msgSender()];
        require(amount > 0, "Nothing to claim");

        uint256 elapsedTimeSinceStart = block.timestamp - claimStartTime;
        require(elapsedTimeSinceStart >= CLIFF_DURATION_SRK, "Vesting cliff not reached");

        uint256 claimable;

        if (elapsedTimeSinceStart >= CLIFF_DURATION_SRK + VESTING_DURATION_SRK) {
            claimable = amount;
        } else {
            elapsedTimeSinceStart = elapsedTimeSinceStart - CLIFF_DURATION_SRK;
            uint256 intervalsSinceStart = elapsedTimeSinceStart / VESTING_INTERVAL;
            uint256 elapsedTimeSinceLastClaim;
            uint256 intervalsSinceLastClaim;
            uint256 totalIntervals = VESTING_DURATION_SRK / VESTING_INTERVAL;

            if(userLastClaimSRK[_msgSender()] == 0){
                elapsedTimeSinceLastClaim = block.timestamp - claimStartTime;
            }
            else{
                elapsedTimeSinceLastClaim = block.timestamp - userLastClaimSRK[_msgSender()];
                intervalsSinceLastClaim = elapsedTimeSinceLastClaim / VESTING_INTERVAL;
            }
            claimable = (amount * (intervalsSinceStart - intervalsSinceLastClaim)) / totalIntervals;
        }
        require(claimable > 0 , "No tokens to claim");

        userDepositsSRK[_msgSender()] = amount - claimable;
        userLastClaimSRK[_msgSender()] = block.timestamp;

        if (claimable > 0) {
            bool successSRK = IERC20(SRKToken).transfer(_msgSender(), claimable);
            require(successSRK, "SRK Token transfer failed");
        }
        emit TokensClaimedSRK(_msgSender(), claimable, block.timestamp);
        return true;
    }

    /**
     * @dev To claim HH tokens after claiming starts
     */
    function claimHH() external nonReentrant whenNotPaused returns (bool) {
        require(HHToken != address(0), "HH token not added");
        require(claimStarted, "Claim has not started yet");

        uint256 amount = userDepositsHH[_msgSender()];
        require(amount > 0, "Nothing to claim");

        uint256 elapsedTimeSinceStart = block.timestamp - claimStartTime;
        require(elapsedTimeSinceStart >= CLIFF_DURATION_HH, "Vesting cliff not reached");

        uint256 claimable;

        if (elapsedTimeSinceStart >= CLIFF_DURATION_HH + VESTING_DURATION_HH ) {
            claimable = amount;
        } else {
            elapsedTimeSinceStart = elapsedTimeSinceStart - CLIFF_DURATION_HH;
            uint256 intervalsSinceStart = elapsedTimeSinceStart / VESTING_INTERVAL;
            uint256 elapsedTimeSinceLastClaim;
            uint256 intervalsSinceLastClaim;
            uint256 totalIntervals = VESTING_DURATION_HH / VESTING_INTERVAL;

            if(userLastClaimHH[_msgSender()] == 0){
                elapsedTimeSinceLastClaim = block.timestamp - claimStartTime;
            }
            else{
                elapsedTimeSinceLastClaim = block.timestamp - userLastClaimHH[_msgSender()];
                intervalsSinceLastClaim = elapsedTimeSinceLastClaim / VESTING_INTERVAL;
            }

            claimable = (amount * (intervalsSinceStart - intervalsSinceLastClaim)) / totalIntervals;
        }
        require(claimable > 0, "No tokens to claim");

        userDepositsHH[_msgSender()] = amount - claimable;
        userLastClaimHH[_msgSender()] = block.timestamp;

        if (claimable > 0) {
            bool successHH = IERC20(HHToken).transfer(_msgSender(), claimable);
            require(successHH, "HH Token transfer failed");
        }

        emit TokensClaimedHH(_msgSender(), claimable, block.timestamp);
        return true;
    }

    /**
     * @dev Base decimals to Token
     */
    function baseDecimals() public pure returns(uint256 ){
        return 18;
    }

    /**
     * @dev Stable coins decimals to Tokens
     */
    function stableCoinsDecimals() public pure returns(uint256 ){
        return 6;
    }

    /**
     * @dev To pause the Seed Round
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev To unpause the Seed Round
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
