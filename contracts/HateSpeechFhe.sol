// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HateSpeechFhe is SepoliaConfig {
    struct EncryptedContent {
        uint256 id;
        euint32 encryptedText;         // Encrypted text content
        euint32 encryptedLanguage;     // Encrypted language identifier
        euint32 encryptedHateScore;    // Encrypted hate speech probability
        uint256 timestamp;
    }
    
    struct ModelUpdate {
        euint32 encryptedWeights;
        euint32 encryptedBias;
        uint256 timestamp;
    }
    
    struct PlatformModel {
        address platformAddress;
        euint32 encryptedLocalWeights;
        euint32 encryptedLocalBias;
    }

    uint256 public contentCount;
    uint256 public modelVersion;
    mapping(uint256 => EncryptedContent) public encryptedContents;
    mapping(uint256 => ModelUpdate) public modelUpdates;
    mapping(address => PlatformModel) public platformModels;
    
    mapping(uint256 => uint256) private requestToContentId;
    mapping(uint256 => uint256) private requestToModelId;
    
    event ContentSubmitted(uint256 indexed id, uint256 timestamp);
    event ModelUpdated(uint256 indexed version, uint256 timestamp);
    event PlatformRegistered(address indexed platform);
    event DecryptionRequested(uint256 indexed id);
    
    modifier onlyPlatform() {
        require(platformModels[msg.sender].platformAddress != address(0), "Not registered platform");
        _;
    }
    
    function registerPlatform() public {
        platformModels[msg.sender] = PlatformModel({
            platformAddress: msg.sender,
            encryptedLocalWeights: FHE.asEuint32(0),
            encryptedLocalBias: FHE.asEuint32(0)
        });
        
        emit PlatformRegistered(msg.sender);
    }
    
    function submitEncryptedContent(
        euint32 encryptedText,
        euint32 encryptedLanguage,
        euint32 encryptedHateScore
    ) public onlyPlatform {
        contentCount += 1;
        uint256 newId = contentCount;
        
        encryptedContents[newId] = EncryptedContent({
            id: newId,
            encryptedText: encryptedText,
            encryptedLanguage: encryptedLanguage,
            encryptedHateScore: encryptedHateScore,
            timestamp: block.timestamp
        });
        
        emit ContentSubmitted(newId, block.timestamp);
    }
    
    function submitModelUpdate(
        euint32 encryptedWeights,
        euint32 encryptedBias
    ) public onlyPlatform {
        modelVersion += 1;
        
        platformModels[msg.sender].encryptedLocalWeights = encryptedWeights;
        platformModels[msg.sender].encryptedLocalBias = encryptedBias;
        
        modelUpdates[modelVersion] = ModelUpdate({
            encryptedWeights: encryptedWeights,
            encryptedBias: encryptedBias,
            timestamp: block.timestamp
        });
        
        emit ModelUpdated(modelVersion, block.timestamp);
    }
    
    function federatedLearning() public onlyPlatform {
        euint32 totalWeights = FHE.asEuint32(0);
        euint32 totalBias = FHE.asEuint32(0);
        uint256 platformCount = 0;
        
        for (uint i = 0; i < contentCount; i++) {
            if (platformModels[address(uint160(i))].platformAddress != address(0)) {
                totalWeights = FHE.add(
                    totalWeights,
                    platformModels[address(uint160(i))].encryptedLocalWeights
                );
                totalBias = FHE.add(
                    totalBias,
                    platformModels[address(uint160(i))].encryptedLocalBias
                );
                platformCount++;
            }
        }
        
        euint32 avgWeights = FHE.div(totalWeights, FHE.asEuint32(platformCount));
        euint32 avgBias = FHE.div(totalBias, FHE.asEuint32(platformCount));
        
        modelVersion += 1;
        modelUpdates[modelVersion] = ModelUpdate({
            encryptedWeights: avgWeights,
            encryptedBias: avgBias,
            timestamp: block.timestamp
        });
    }
    
    function detectHateSpeech(uint256 contentId) public view returns (ebool) {
        EncryptedContent storage content = encryptedContents[contentId];
        ModelUpdate storage model = modelUpdates[modelVersion];
        
        return FHE.gt(
            content.encryptedHateScore,
            FHE.add(model.encryptedBias, FHE.asEuint32(50)) // Threshold = bias + 50
        );
    }
    
    function requestContentDecryption(uint256 contentId) public onlyPlatform {
        EncryptedContent storage content = encryptedContents[contentId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(content.encryptedText);
        ciphertexts[1] = FHE.toBytes32(content.encryptedLanguage);
        ciphertexts[2] = FHE.toBytes32(content.encryptedHateScore);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptContent.selector);
        requestToContentId[reqId] = contentId;
        
        emit DecryptionRequested(contentId);
    }
    
    function decryptContent(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 contentId = requestToContentId[requestId];
        require(contentId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted content data
        uint32[] memory contentData = abi.decode(cleartexts, (uint32[]));
    }
    
    function requestModelDecryption(uint256 modelId) public onlyPlatform {
        ModelUpdate storage model = modelUpdates[modelId];
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(model.encryptedWeights);
        ciphertexts[1] = FHE.toBytes32(model.encryptedBias);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptModel.selector);
        requestToModelId[reqId] = modelId;
    }
    
    function decryptModel(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 modelId = requestToModelId[requestId];
        require(modelId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted model data
        uint32[] memory modelData = abi.decode(cleartexts, (uint32[]));
    }
    
    function getLatestModelVersion() public view returns (uint256) {
        return modelVersion;
    }
    
    function getPlatformCount() public view returns (uint256) {
        uint256 count = 0;
        for (uint i = 0; i < contentCount; i++) {
            if (platformModels[address(uint160(i))].platformAddress != address(0)) {
                count++;
            }
        }
        return count;
    }
    
    function batchDetectHateSpeech(uint256[] memory contentIds) public view returns (ebool[] memory) {
        ebool[] memory results = new ebool[](contentIds.length);
        for (uint i = 0; i < contentIds.length; i++) {
            results[i] = detectHateSpeech(contentIds[i]);
        }
        return results;
    }
}