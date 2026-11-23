// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title RichBucks (RB)
 * @notice Whole-number (0 decimals) office joke token on a private zero-gas Besu chain.
 * @dev Daily tips and verifier rewards mint under maxSupply. Welcome/admin mint can be disabled for a public launch.
 */
contract RichBucks is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    uint256 public maxSupply;
    uint256 public dailyAllowance;
    uint256 public verifierReward;
    uint256 public welcomeAmount;
    address public treasury;

    /// @notice Added to block.timestamp before / 1 days (e.g. 0 = UTC/GMT, 3600 = BST).
    int64 public timezoneOffsetSeconds;

    bool public welcomeMintEnabled;
    bool public adminMintEnabled;
    bool public dailyTipEnabled;

    mapping(address => uint256) public lastGiftedDay;
    mapping(address => bool) public welcomeClaimed;

    event DailyTipSent(
        address indexed from,
        address indexed to,
        uint256 amount,
        address indexed proposer,
        uint256 verifierAmount,
        string reason
    );
    event WelcomeMinted(address indexed to, uint256 amount);
    event AdminMinted(address indexed to, uint256 amount, address indexed operator);
    event BridgeLocked(address indexed from, address indexed baseDestination, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address initialTreasury) external initializer {
        require(initialOwner != address(0) && initialTreasury != address(0), "zero");

        __ERC20_init("RichBucks", "RB");
        __ERC20Permit_init("RichBucks");
        __Ownable_init(initialOwner);

        treasury = initialTreasury;
        maxSupply = 10_000_000;
        dailyAllowance = 1;
        verifierReward = 1;
        welcomeAmount = 10;
        timezoneOffsetSeconds = 0; // set to London offset via admin as needed
        welcomeMintEnabled = true;
        adminMintEnabled = true;
        dailyTipEnabled = true;

        _mint(initialTreasury, 1_000_000);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function currentDay() public view returns (uint256) {
        int256 adjusted = int256(block.timestamp) + int256(timezoneOffsetSeconds);
        require(adjusted >= 0, "time");
        return uint256(adjusted) / 1 days;
    }

    function giveDailyTip(address recipient, string calldata reason) external {
        require(dailyTipEnabled, "tips off");
        require(recipient != address(0) && recipient != msg.sender, "bad recipient");

        uint256 today = currentDay();
        require(lastGiftedDay[msg.sender] < today, "already tipped today");
        lastGiftedDay[msg.sender] = today;

        _mintUnderCap(recipient, dailyAllowance);

        address proposer = block.coinbase;
        uint256 vReward = 0;
        if (verifierReward > 0 && proposer != address(0)) {
            vReward = verifierReward;
            _mintUnderCap(proposer, vReward);
        }

        emit DailyTipSent(msg.sender, recipient, dailyAllowance, proposer, vReward, reason);
    }

    /// @notice Bot/admin mints welcome pack once per address (not from treasury).
    function mintWelcome(address to) external onlyOwner {
        require(welcomeMintEnabled, "welcome off");
        require(to != address(0), "zero");
        require(!welcomeClaimed[to], "claimed");
        welcomeClaimed[to] = true;
        _mintUnderCap(to, welcomeAmount);
        emit WelcomeMinted(to, welcomeAmount);
    }

    function mintAdmin(address to, uint256 amount) external onlyOwner {
        require(adminMintEnabled, "admin mint off");
        require(to != address(0) && amount > 0, "bad");
        _mintUnderCap(to, amount);
        emit AdminMinted(to, amount, msg.sender);
    }

    function bridgeLock(uint256 amount, address baseDestination) external {
        require(amount > 0 && baseDestination != address(0), "bad");
        _burn(msg.sender, amount);
        emit BridgeLocked(msg.sender, baseDestination, amount);
    }

    function setMaxSupply(uint256 newMax) external onlyOwner {
        require(newMax >= totalSupply(), "below supply");
        maxSupply = newMax;
    }

    function setDailyAllowance(uint256 amount) external onlyOwner {
        dailyAllowance = amount;
    }

    function setVerifierReward(uint256 amount) external onlyOwner {
        verifierReward = amount;
    }

    function setWelcomeAmount(uint256 amount) external onlyOwner {
        welcomeAmount = amount;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "zero");
        treasury = newTreasury;
    }

    function setTimezoneOffsetSeconds(int64 offset) external onlyOwner {
        timezoneOffsetSeconds = offset;
    }

    function setWelcomeMintEnabled(bool enabled) external onlyOwner {
        welcomeMintEnabled = enabled;
    }

    function setAdminMintEnabled(bool enabled) external onlyOwner {
        adminMintEnabled = enabled;
    }

    function setDailyTipEnabled(bool enabled) external onlyOwner {
        dailyTipEnabled = enabled;
    }

    function _mintUnderCap(address to, uint256 amount) internal {
        require(totalSupply() + amount <= maxSupply, "cap");
        _mint(to, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
