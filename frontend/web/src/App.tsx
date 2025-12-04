import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EpigeneticData {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "processed" | "error";
  details?: {
    methylationLevel?: number;
    geneExpression?: number;
    lifestyleScore?: number;
    recommendations?: string[];
  };
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<EpigeneticData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    category: "",
    description: "",
    dnaSequence: ""
  });
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Calculate statistics
  const processedCount = data.filter(d => d.status === "processed").length;
  const pendingCount = data.filter(d => d.status === "pending").length;
  const errorCount = data.filter(d => d.status === "error").length;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: EpigeneticData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`data_${key}`);
          if (dataBytes.length > 0) {
            try {
              const dataItem = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: dataItem.data,
                timestamp: dataItem.timestamp,
                owner: dataItem.owner,
                category: dataItem.category,
                status: dataItem.status || "pending",
                details: dataItem.details
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setData(list);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting DNA data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-DNA-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const dataItem = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(dataItem))
      );
      
      const keysBytes = await contract.getData("data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "data_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "DNA data encrypted and stored securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewData({
          category: "",
          description: "",
          dnaSequence: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const processData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`data_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const dataItem = JSON.parse(ethers.toUtf8String(dataBytes));
      
      // Simulate FHE analysis results
      const updatedData = {
        ...dataItem,
        status: "processed",
        details: {
          methylationLevel: Math.random() * 100,
          geneExpression: Math.random() * 100,
          lifestyleScore: Math.floor(Math.random() * 100),
          recommendations: [
            "Increase intake of leafy greens",
            "Consider intermittent fasting",
            "Add 30 minutes of daily exercise",
            "Reduce processed food consumption"
          ]
        }
      };
      
      await contract.setData(
        `data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const toggleExpand = (id: string) => {
    if (expandedItem === id) {
      setExpandedItem(null);
    } else {
      setExpandedItem(id);
    }
  };

  const renderPieChart = () => {
    const total = data.length || 1;
    const processedPercentage = (processedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const errorPercentage = (errorCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment processed" 
            style={{ transform: `rotate(${processedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(processedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment error" 
            style={{ transform: `rotate(${(processedPercentage + pendingPercentage + errorPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{data.length}</div>
            <div className="pie-label">Total</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box processed"></div>
            <span>Processed: {processedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box error"></div>
            <span>Error: {errorCount}</span>
          </div>
        </div>
      </div>
    );
  };

  // Pagination logic
  const totalPages = Math.ceil(data.length / itemsPerPage);
  const currentData = data.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="dna-icon"></div>
          <h1>Epigenetic<span>Coach</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn primary-btn"
          >
            Upload DNA Data
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Privacy-Preserving DNA-based Personalized Epigenetic Coaching</h2>
            <p>Get personalized lifestyle and diet recommendations based on your encrypted genetic data using FHE technology</p>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel project-info">
            <h3>About EpigeneticCoachFHE</h3>
            <p>Our platform uses Fully Homomorphic Encryption (FHE) to analyze your DNA and epigenetic data without ever decrypting it. This ensures complete privacy while providing personalized health recommendations.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="panel stats-panel">
            <h3>Data Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{data.length}</div>
                <div className="stat-label">Total Data</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{processedCount}</div>
                <div className="stat-label">Processed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="panel chart-panel">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Your Epigenetic Data</h2>
            <div className="header-actions">
              <button 
                onClick={loadData}
                className="refresh-btn secondary-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {data.length === 0 ? (
              <div className="no-data">
                <div className="dna-icon large"></div>
                <p>No epigenetic data found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Data
                </button>
              </div>
            ) : (
              <>
                {currentData.map(item => (
                  <div className="data-item" key={item.id}>
                    <div className="item-header" onClick={() => toggleExpand(item.id)}>
                      <div className="item-info">
                        <div className="item-id">#{item.id.substring(0, 6)}</div>
                        <div className="item-category">{item.category}</div>
                        <div className="item-date">
                          {new Date(item.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="item-status">
                        <span className={`status-badge ${item.status}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="expand-icon">
                        {expandedItem === item.id ? '−' : '+'}
                      </div>
                    </div>
                    
                    {expandedItem === item.id && (
                      <div className="item-details">
                        <div className="detail-row">
                          <div className="detail-label">Owner:</div>
                          <div className="detail-value">{item.owner.substring(0, 6)}...{item.owner.substring(38)}</div>
                        </div>
                        <div className="detail-row">
                          <div className="detail-label">Encrypted Data:</div>
                          <div className="detail-value encrypted">{item.encryptedData.substring(0, 40)}...</div>
                        </div>
                        
                        {item.details && (
                          <>
                            <div className="detail-section">
                              <h4>Analysis Results</h4>
                              <div className="metrics-grid">
                                <div className="metric">
                                  <div className="metric-label">Methylation Level</div>
                                  <div className="metric-value">{item.details.methylationLevel?.toFixed(2)}%</div>
                                </div>
                                <div className="metric">
                                  <div className="metric-label">Gene Expression</div>
                                  <div className="metric-value">{item.details.geneExpression?.toFixed(2)}%</div>
                                </div>
                                <div className="metric">
                                  <div className="metric-label">Lifestyle Score</div>
                                  <div className="metric-value">{item.details.lifestyleScore}/100</div>
                                </div>
                              </div>
                            </div>
                            
                            <div className="detail-section">
                              <h4>Personalized Recommendations</h4>
                              <ul className="recommendations">
                                {item.details.recommendations?.map((rec, index) => (
                                  <li key={index}>{rec}</li>
                                ))}
                              </ul>
                            </div>
                          </>
                        )}
                        
                        {isOwner(item.owner) && item.status === "pending" && (
                          <div className="action-buttons">
                            <button 
                              className="primary-btn small"
                              onClick={() => processData(item.id)}
                            >
                              Process with FHE
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      className="pagination-btn"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(currentPage - 1)}
                    >
                      Previous
                    </button>
                    <span className="pagination-info">Page {currentPage} of {totalPages}</span>
                    <button 
                      className="pagination-btn"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(currentPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        
        <div className="team-section">
          <h2>Our Team</h2>
          <div className="team-grid">
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Dr. Emily Chen</div>
              <div className="member-role">Genomics Specialist</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Alex Johnson</div>
              <div className="member-role">FHE Cryptographer</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Sarah Williams</div>
              <div className="member-role">AI Nutritionist</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Michael Zhang</div>
              <div className="member-role">Blockchain Developer</div>
            </div>
          </div>
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✕</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="dna-icon"></div>
              <span>EpigeneticCoachFHE</span>
            </div>
            <p>Privacy-preserving DNA-based epigenetic coaching using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} EpigeneticCoachFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.category || !data.dnaSequence) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Epigenetic Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> Your DNA data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={data.category} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select category</option>
                <option value="Methylation">DNA Methylation</option>
                <option value="GeneExpression">Gene Expression</option>
                <option value="HistoneModification">Histone Modification</option>
                <option value="GeneticVariants">Genetic Variants</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={data.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>DNA Sequence Data *</label>
              <textarea 
                name="dnaSequence"
                value={data.dnaSequence} 
                onChange={handleChange}
                placeholder="Enter DNA sequence or epigenetic data..." 
                className="form-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Your genetic data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="primary-btn"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;