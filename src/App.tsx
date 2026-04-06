/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, FormEvent, useEffect, Component, ReactNode } from 'react';
import { 
  Search, 
  Plus, 
  FileText, 
  Download, 
  Filter, 
  MoreVertical, 
  AlertCircle,
  CheckCircle2,
  Package,
  TrendingUp,
  History,
  Edit2,
  Trash2,
  X,
  Calendar,
  Wrench,
  Ban,
  Upload,
  ClipboardCheck,
  Printer,
  Moon,
  Sun,
  LogOut,
  LogIn,
  User,
  Lock,
  Mail,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { Asset, AssetType, InventoryLog, UserProfile, UserRole } from './types';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  User as FirebaseUser,
  sendEmailVerification
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  setDoc,
  getDoc,
  getDocFromServer
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    // @ts-ignore
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      let message = "Đã xảy ra lỗi không mong muốn.";
      try {
        // @ts-ignore
        const firestoreError = JSON.parse(this.state.error?.message || "");
        if (firestoreError.error.includes("permissions")) {
          message = "Bạn không có quyền thực hiện thao tác này. Vui lòng kiểm tra trạng thái tài khoản.";
        }
      } catch (e) {
        // Not a firestore error JSON
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Oops! Có lỗi xảy ra</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}

export default function App() {
  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
          setToast({ message: "Lỗi kết nối Firebase. Vui lòng kiểm tra cấu hình.", type: 'error' });
        }
      }
    }
    testConnection();
  }, []);

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState('');

  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('darkMode');
      return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'damaged' | 'liquidated' | 'history' | 'inventory' | 'users'>('all');
  const [assetTypeFilter, setAssetTypeFilter] = useState<'all' | AssetType>('all');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [viewingHistoryAsset, setViewingHistoryAsset] = useState<Asset | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Inventory State
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [isInventorying, setIsInventorying] = useState(false);
  const [inventoryDate, setInventoryDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentInventory, setCurrentInventory] = useState<{
    assetId: string;
    status: 'ok' | 'missing' | 'damaged';
    note: string;
  }[]>([]);
  const [newAsset, setNewAsset] = useState<Partial<Asset>>({
    type: 'fixed',
    dateAdded: new Date().toISOString().split('T')[0],
    unit: 'Cái',
    quantityAdded: 1,
    quantityRemaining: 1,
    totalValue: 0,
    allocatedAmount: 0,
    remainingAmount: 0,
    notes: '',
    history: []
  });

  // Auth Effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setUserProfile(null);
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // User Profile Sync
  useEffect(() => {
    if (!user) return;
    const path = `users/${user.uid}`;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile(snapshot.data() as UserProfile);
      } else {
        // If profile doesn't exist, it might be the initial admin or a new user
        if (user.email === 'ngmanhha2@gmail.com') {
          const initialAdmin: UserProfile = {
            uid: user.uid,
            email: user.email!,
            role: 'admin',
            status: 'active',
            createdAt: new Date().toISOString()
          };
          setDoc(doc(db, 'users', user.uid), initialAdmin).catch(e => handleFirestoreError(e, OperationType.WRITE, path));
        }
      }
      setAuthLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
    return () => unsubscribe();
  }, [user]);

  // All Users Sync (Admin only)
  useEffect(() => {
    if (userProfile?.role !== 'admin') {
      setAllUsers([]);
      return;
    }
    const path = 'users';
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as UserProfile);
      setAllUsers(usersData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [userProfile]);

  // Firestore Sync - Assets
  useEffect(() => {
    if (!user || (userProfile?.status !== 'active' && user.email !== 'ngmanhha2@gmail.com')) return;
    const path = 'assets';
    const q = query(collection(db, 'assets'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assetsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Asset));
      setAssets(assetsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user, userProfile]);

  // Firestore Sync - Inventory Logs
  useEffect(() => {
    if (!user || (userProfile?.status !== 'active' && user.email !== 'ngmanhha2@gmail.com')) return;
    const path = 'inventoryLogs';
    const q = query(collection(db, 'inventoryLogs'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));
      setInventoryLogs(logsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user, userProfile]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, loginEmail, loginPassword);
        const newUser = userCredential.user;
        
        // Create pending user profile
        const newProfile: UserProfile = {
          uid: newUser.uid,
          email: newUser.email!,
          role: 'user',
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'users', newUser.uid), newProfile).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${newUser.uid}`));
        await sendEmailVerification(newUser);
        alert('Đã gửi email xác thực. Vui lòng kiểm tra hộp thư của bạn.');
      } else {
        await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      }
    } catch (error: any) {
      setAuthError(error.message);
    }
  };

  const handleUpdateUserStatus = async (uid: string, status: 'active' | 'disabled') => {
    const path = `users/${uid}`;
    await updateDoc(doc(db, 'users', uid), { status }).catch(e => handleFirestoreError(e, OperationType.UPDATE, path));
  };

  const handleUpdateUserRole = async (uid: string, role: UserRole) => {
    const path = `users/${uid}`;
    await updateDoc(doc(db, 'users', uid), { role }).catch(e => handleFirestoreError(e, OperationType.UPDATE, path));
  };

  const globalHistory = useMemo(() => {
    return assets.flatMap(asset => 
      asset.history.map(h => ({ ...h, assetName: asset.name, assetCode: asset.code }))
    ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [assets]);

  const searchSuggestions = useMemo(() => {
    if (searchTerm.length < 2) return [];
    return assets.filter(asset => 
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.code.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 5);
  }, [assets, searchTerm]);

  const filteredAssets = useMemo(() => {
    let result = assets;
    
    if (activeTab === 'damaged') {
      result = result.filter(asset => asset.notes.toLowerCase().includes('hỏng') && !asset.liquidatedDate);
    } else if (activeTab === 'liquidated') {
      result = result.filter(asset => !!asset.liquidatedDate);
    } else {
      result = result.filter(asset => !asset.liquidatedDate);
    }

    if (assetTypeFilter !== 'all') {
      result = result.filter(asset => asset.type === assetTypeFilter);
    }

    return result.filter(asset => 
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.code.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [assets, searchTerm, activeTab, assetTypeFilter]);

  const stats = useMemo(() => {
    const activeAssets = assets.filter(a => !a.liquidatedDate);
    const total = activeAssets.reduce((acc, curr) => acc + curr.totalValue, 0);
    const remaining = activeAssets.reduce((acc, curr) => acc + curr.remainingAmount, 0);
    const count = activeAssets.length;
    const damaged = activeAssets.filter(a => a.notes.toLowerCase().includes('hỏng')).length;
    const fixedCount = activeAssets.filter(a => a.type === 'fixed').length;
    const toolCount = activeAssets.filter(a => a.type === 'tool').length;
    const liquidatedCount = assets.filter(a => !!a.liquidatedDate).length;
    return { total, remaining, count, damaged, fixedCount, toolCount, liquidatedCount };
  }, [assets]);

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const handleRepair = async (id: string) => {
    const today = new Date().toISOString().split('T')[0];
    const asset = assets.find(a => a.id === id);
    if (!asset) return;
    
    const path = `assets/${id}`;
    await updateDoc(doc(db, 'assets', id), {
      notes: asset.notes.replace(/đã hỏng|hỏng/gi, '').trim(),
      history: [
        ...asset.history,
        { id: Math.random().toString(36).substr(2, 9), date: today, type: 'repair', description: 'Đã sửa chữa và đưa vào sử dụng lại' }
      ]
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, path));
  };

  const handleLiquidate = async (id: string) => {
    const today = new Date().toISOString().split('T')[0];
    const asset = assets.find(a => a.id === id);
    if (!asset) return;

    if (confirm('Bạn có chắc chắn muốn thanh lý tài sản này?')) {
      const path = `assets/${id}`;
      await updateDoc(doc(db, 'assets', id), {
        liquidatedDate: today,
        history: [
          ...asset.history,
          { id: Math.random().toString(36).substr(2, 9), date: today, type: 'liquidate', description: 'Thanh lý tài sản' }
        ]
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, path));
    }
  };

  const startInventory = () => {
    setIsInventorying(true);
    setInventoryDate(new Date().toISOString().split('T')[0]);
    setCurrentInventory(assets.filter(a => !a.liquidatedDate).map(a => ({
      assetId: a.id,
      status: 'ok',
      note: ''
    })));
  };

  const updateInventoryStatus = (assetId: string, status: 'ok' | 'missing' | 'damaged', note: string) => {
    setCurrentInventory(prev => prev.map(item => 
      item.assetId === assetId ? { ...item, status, note } : item
    ));
  };

  const finishInventory = async () => {
    const logRef = doc(collection(db, 'inventoryLogs'));
    const newLog: InventoryLog = {
      id: logRef.id,
      date: inventoryDate,
      performedBy: user?.email || 'Admin',
      items: currentInventory.map(item => {
        const asset = assets.find(a => a.id === item.assetId);
        return {
          assetId: item.assetId,
          assetName: asset?.name || '',
          assetCode: asset?.code || '',
          status: item.status,
          note: item.note
        };
      })
    };

    const logPath = `inventoryLogs/${logRef.id}`;
    await setDoc(logRef, newLog).catch(e => handleFirestoreError(e, OperationType.CREATE, logPath));
    
    // Update asset history for each item in inventory
    for (const item of currentInventory) {
      const asset = assets.find(a => a.id === item.assetId);
      if (asset) {
        const assetPath = `assets/${asset.id}`;
        const statusText = item.status === 'ok' ? 'Đủ' : item.status === 'missing' ? 'Thiếu' : 'Hỏng';
        await updateDoc(doc(db, 'assets', asset.id), {
          history: [
            ...asset.history,
            { 
              id: Math.random().toString(36).substr(2, 9), 
              date: inventoryDate, 
              type: 'inventory', 
              description: `Kiểm kê định kỳ: Trạng thái ${statusText}. Ghi chú: ${item.note || 'Không có'}` 
            }
          ]
        }).catch(e => handleFirestoreError(e, OperationType.UPDATE, assetPath));
      }
    }

    setIsInventorying(false);
    alert('Đã lưu kết quả kiểm kê vào nhật ký hệ thống!');
  };

  const handlePrintInventory = (log: InventoryLog) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>Báo cáo kiểm kê tài sản - ${log.date}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            h1 { text-align: center; color: #1e293b; }
            .header-info { margin-bottom: 30px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; font-size: 14px; }
            th { bg-color: #f8fafc; font-weight: bold; }
            .status-ok { color: #059669; }
            .status-missing { color: #dc2626; }
            .status-damaged { color: #d97706; }
            .footer { margin-top: 50px; display: flex; justify-content: space-between; }
            .signature { text-align: center; width: 200px; }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>BÁO CÁO KIỂM KÊ TÀI SẢN</h1>
          <div class="header-info">
            <p><strong>Ngày kiểm kê:</strong> ${new Date(log.date).toLocaleDateString('vi-VN')}</p>
            <p><strong>Người thực hiện:</strong> ${log.performedBy}</p>
            <p><strong>Đơn vị:</strong> Phòng X-Quang</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>STT</th>
                <th>Mã tài sản</th>
                <th>Tên tài sản</th>
                <th>Trạng thái</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              ${log.items.map((item, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${item.assetCode}</td>
                  <td>${item.assetName}</td>
                  <td class="status-${item.status}">
                    ${item.status === 'ok' ? 'Đủ' : item.status === 'missing' ? 'Thiếu' : 'Hỏng'}
                  </td>
                  <td>${item.note || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">
            <div class="signature">
              <p>Người lập biểu</p>
              <br><br><br>
              <p>..........................</p>
            </div>
            <div class="signature">
              <p>Trưởng phòng X-Quang</p>
              <br><br><br>
              <p>..........................</p>
            </div>
          </div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    
    const originalAsset = assets.find(a => a.id === editingAsset.id);
    const hasChanged = JSON.stringify(originalAsset) !== JSON.stringify(editingAsset);
    
    let updatedAsset = { ...editingAsset };
    
    if (hasChanged) {
      updatedAsset.history = [
        ...updatedAsset.history,
        { 
          id: Math.random().toString(36).substr(2, 9), 
          date: new Date().toISOString().split('T')[0], 
          type: 'update', 
          description: 'Cập nhật thông tin tài sản' 
        }
      ];
    }

    const { id, ...data } = updatedAsset;
    const path = `assets/${id}`;
    await updateDoc(doc(db, 'assets', id), data).catch(e => handleFirestoreError(e, OperationType.UPDATE, path));
    setEditingAsset(null);
  };

  const handleDeleteAsset = async (id: string) => {
    const path = `assets/${id}`;
    try {
      await deleteDoc(doc(db, 'assets', id));
      setEditingAsset(null);
      setIsConfirmingDelete(null);
      setToast({ message: 'Đã xóa tài sản thành công!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleCreateAsset = async (e: FormEvent) => {
    e.preventDefault();
    const today = new Date().toISOString().split('T')[0];
    const assetRef = doc(collection(db, 'assets'));
    const newAssetFull: Asset = {
      ...(newAsset as Asset),
      id: assetRef.id,
      quantityReduced: 0,
      allocatedAmount: 0,
      inventoryCount: 1,
      history: [
        { id: Math.random().toString(36).substr(2, 9), date: today, type: 'update', description: 'Khởi tạo tài sản mới' }
      ]
    };
    
    const path = `assets/${assetRef.id}`;
    await setDoc(assetRef, newAssetFull).catch(e => handleFirestoreError(e, OperationType.CREATE, path));
    setIsAddingNew(false);
    setNewAsset({
      type: 'fixed',
      dateAdded: today,
      unit: 'Cái',
      quantityAdded: 1,
      quantityRemaining: 1,
      totalValue: 0,
      allocatedAmount: 0,
      remainingAmount: 0,
      notes: '',
      history: []
    });
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setUserProfile(null);
      setAllUsers([]);
      setActiveTab('all');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Mã tài sản': 'MA001',
        'Tên tài sản': 'Tên tài sản mẫu',
        'Phân loại': 'Công cụ dụng cụ',
        'Ngày bắt đầu': '2024-01-01',
        'ĐVT': 'Cái',
        'Số lượng': 1,
        'Giá trị gốc': 1000000,
        'Giá trị đã phân bổ': 0,
        'Ghi chú': ''
      }
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    XLSX.writeFile(workbook, 'Mau_Nhap_Tai_San.xlsx');
  };

  const handleImportExcel = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const today = new Date().toISOString().split('T')[0];
      const importedAssets = jsonData.map((row: any) => {
        const rawTotalValue = Number(row['Tổng giá trị'] || row['Giá trị gốc'] || 0);
        const rawAllocatedAmount = Number(row['Giá trị đã phân bổ'] || row['Đã phân bổ'] || 0);
        const rawQuantity = Number(row['Số lượng'] || row['SL'] || 1);
        
        const totalValue = isNaN(rawTotalValue) ? 0 : rawTotalValue;
        const allocatedAmount = isNaN(rawAllocatedAmount) ? 0 : rawAllocatedAmount;
        const quantity = isNaN(rawQuantity) ? 1 : rawQuantity;
        
        return {
          code: String(row['Mã tài sản'] || row['Mã'] || `TS-${Math.random().toString(36).substr(2, 5).toUpperCase()}`),
          name: String(row['Tên tài sản'] || row['Tên'] || 'Tài sản không tên'),
          type: (String(row['Phân loại'] || '').toLowerCase().includes('cố định') || String(row['Loại'] || '').toLowerCase().includes('fixed')) ? 'fixed' : 'tool',
          dateAdded: String(row['Ngày bắt đầu'] || row['Ngày nhập'] || today),
          unit: String(row['ĐVT'] || row['Đơn vị'] || 'Cái'),
          quantityAdded: quantity,
          quantityReduced: 0,
          quantityRemaining: quantity,
          totalValue: totalValue,
          allocatedAmount: allocatedAmount,
          remainingAmount: totalValue - allocatedAmount,
          inventoryCount: quantity,
          notes: String(row['Ghi chú'] || ''),
          history: [
            { id: Math.random().toString(36).substr(2, 9), date: today, type: 'update', description: 'Nhập từ file Excel' }
          ]
        };
      });

      if (importedAssets.length > 0) {
        try {
          // Use setDoc with pre-generated IDs for faster parallel writes and rule compliance
          let successCount = 0;
          await Promise.all(importedAssets.map(async (assetData) => {
            const assetRef = doc(collection(db, 'assets'));
            const assetWithId = { ...assetData, id: assetRef.id };
            await setDoc(assetRef, assetWithId);
            successCount++;
          }));
          
          setToast({ message: `Đã nhập thành công ${successCount} tài sản!`, type: 'success' });
          setTimeout(() => setToast(null), 3000);
        } catch (error) {
          console.error("Excel Import Error:", error);
          handleFirestoreError(error, OperationType.CREATE, 'assets');
        }
      }
    };
    reader.readAsArrayBuffer(file);
    // Clear input
    e.target.value = '';
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
  };

  if (authLoading) {
    return (
      <ErrorBoundary>
        <div className={`min-h-screen flex items-center justify-center bg-slate-50 ${darkMode ? 'dark' : ''} dark:bg-slate-950`}>
          <Loader2 className="animate-spin text-blue-600" size={48} />
        </div>
      </ErrorBoundary>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <div className={`min-h-screen flex items-center justify-center bg-slate-50 p-4 transition-colors duration-300 ${darkMode ? 'dark' : ''} dark:bg-slate-950`}>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/20">
                <Package size={32} />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {isRegistering ? 'Đăng ký tài khoản' : 'Đăng nhập hệ thống'}
              </h1>
              <p className="mt-2 text-slate-500 dark:text-slate-400">Quản lý tài sản Phòng X-Quang</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="email"
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
                    placeholder="name@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Mật khẩu</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="password"
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
              </div>

              {authError && (
                <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
                  <AlertCircle size={14} />
                  {authError}
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 active:scale-[0.98] dark:shadow-blue-900/20"
              >
                {isRegistering ? 'Tạo tài khoản' : 'Đăng nhập'}
              </button>
            </form>

            <div className="mt-8 text-center">
              <button
                onClick={() => setIsRegistering(!isRegistering)}
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {isRegistering ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký ngay'}
              </button>
            </div>
            
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </motion.div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className={`min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors duration-300 ${darkMode ? 'dark' : ''} dark:bg-slate-950 dark:text-slate-100`}>
      {/* Header */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/20">
              <Package size={20} className="sm:hidden" />
              <Package size={24} className="hidden sm:block" />
            </div>
            <div className="overflow-hidden">
              <h1 className="truncate text-sm sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white">Quản lý Tài sản</h1>
              <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate dark:text-slate-400">Phòng X-Quang</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="hidden items-center gap-2 mr-2 sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <User size={16} className="text-slate-600 dark:text-slate-400" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-900 dark:text-white max-w-[100px] truncate leading-tight">
                  {user?.email}
                </span>
                <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  {userProfile?.role === 'admin' ? 'Trưởng phòng' : 'Nhân viên'}
                </span>
              </div>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              title={darkMode ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={handleLogout}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-600 transition-all hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
              title="Đăng xuất"
            >
              <LogOut size={18} />
            </button>
            <div className="hidden items-center gap-1 sm:flex">
              <button 
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title="Tải mẫu Excel"
              >
                <FileText size={16} />
                <span className="hidden lg:inline">Tải mẫu</span>
              </button>
              <label className="cursor-pointer flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                <Upload size={16} />
                <span className="hidden lg:inline">Nhập Excel</span>
                <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} />
              </label>
            </div>
            <button 
              onClick={() => setIsAddingNew(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:bg-blue-700 active:scale-95 dark:shadow-blue-900/20"
            >
              <Plus size={16} className="sm:hidden" />
              <Plus size={18} className="hidden sm:block" />
              <span>Thêm mới</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {userProfile?.status === 'pending' && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-400"
          >
            <div className="flex items-center gap-3">
              <AlertCircle size={24} />
              <div>
                <h3 className="font-bold">Tài khoản đang chờ phê duyệt</h3>
                <p className="text-sm">Tài khoản của bạn đã được tạo thành công. Vui lòng đợi Trưởng phòng phê duyệt để có thể xem và quản lý tài sản.</p>
              </div>
            </div>
          </motion.div>
        )}

        {userProfile?.status === 'disabled' && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 dark:border-rose-900/30 dark:bg-rose-900/20 dark:text-rose-400"
          >
            <div className="flex items-center gap-3">
              <Ban size={24} />
              <div>
                <h3 className="font-bold">Tài khoản đã bị khóa</h3>
                <p className="text-sm">Tài khoản của bạn đã bị vô hiệu hóa bởi quản trị viên. Vui lòng liên hệ Trưởng phòng để biết thêm chi tiết.</p>
              </div>
            </div>
          </motion.div>
        )}

        {userProfile?.status === 'active' && activeTab === 'users' && userProfile.role === 'admin' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Quản lý người dùng</h2>
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                <User size={14} />
                {allUsers.length} Người dùng
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50">
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Email</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Vai trò</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Trạng thái</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ngày tạo</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {allUsers.map((u) => (
                      <tr key={u.uid} className="transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                              <User size={16} />
                            </div>
                            <span className="font-medium text-slate-900 dark:text-white">{u.email}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <select
                            value={u.role}
                            disabled={u.email === 'ngmanhha2@gmail.com'}
                            onChange={(e) => handleUpdateUserRole(u.uid, e.target.value as UserRole)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          >
                            <option value="user">Nhân viên</option>
                            <option value="admin">Trưởng phòng</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            u.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            u.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          }`}>
                            {u.status === 'active' ? 'Hoạt động' : u.status === 'pending' ? 'Chờ duyệt' : 'Đã khóa'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                          {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="px-6 py-4">
                          {u.email !== 'ngmanhha2@gmail.com' && (
                            <div className="flex items-center gap-2">
                              {u.status === 'pending' || u.status === 'disabled' ? (
                                <button
                                  onClick={() => handleUpdateUserStatus(u.uid, 'active')}
                                  className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600 transition-all hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400"
                                >
                                  <CheckCircle2 size={14} />
                                  Duyệt
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleUpdateUserStatus(u.uid, 'disabled')}
                                  className="flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600 transition-all hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400"
                                >
                                  <Ban size={14} />
                                  Khóa
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {userProfile?.status === 'active' && activeTab !== 'users' && (
          <div key="main-content">
            {/* Stats Grid */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Tổng số tài sản', value: stats.count, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Tổng giá trị', value: formatCurrency(stats.total), icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Giá trị còn lại', value: formatCurrency(stats.remaining), icon: History, color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: 'Tài sản hỏng/giảm', value: stats.damaged, icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50' },
              ].map((stat, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  key={stat.label}
                  className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.bg} ${stat.color} dark:bg-opacity-10`}>
                    <stat.icon size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white">{stat.value}</p>
                  </div>
                </motion.div>
              ))}
            </div>

        {/* Tabs & Filters */}
        <div className="mb-6 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 no-scrollbar dark:bg-slate-900">
              <button
                onClick={() => setAssetTypeFilter('all')}
                className={`whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  assetTypeFilter === 'all' 
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setAssetTypeFilter('fixed')}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  assetTypeFilter === 'fixed' 
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Tài sản cố định
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  assetTypeFilter === 'fixed' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {stats.fixedCount}
                </span>
              </button>
              <button
                onClick={() => setAssetTypeFilter('tool')}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  assetTypeFilter === 'tool' 
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Công cụ dụng cụ
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  assetTypeFilter === 'tool' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {stats.toolCount}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 no-scrollbar dark:bg-slate-900">
              <button
                onClick={() => setActiveTab('all')}
                className={`whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'all' 
                    ? 'bg-white text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Bình thường
              </button>
              <button
                onClick={() => setActiveTab('damaged')}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'damaged' 
                    ? 'bg-white text-rose-600 shadow-sm dark:bg-slate-800 dark:text-rose-400' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Hư hỏng
                {stats.damaged > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[10px] text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                    {stats.damaged}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('liquidated')}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'liquidated' 
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-200' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Đã thanh lý
                {stats.liquidatedCount > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                    {stats.liquidatedCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'history' 
                    ? 'bg-white text-amber-600 shadow-sm dark:bg-slate-800 dark:text-amber-400' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <History size={16} />
                Nhật ký
              </button>
              <button
                onClick={() => setActiveTab('inventory')}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'inventory' 
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-800 dark:text-indigo-400' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <ClipboardCheck size={16} />
                Kiểm kê
              </button>
              {userProfile?.role === 'admin' && (
                <button
                  onClick={() => setActiveTab('users')}
                  className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                    activeTab === 'users' 
                      ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400' 
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <User size={16} />
                  Người dùng
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex flex-1 w-full sm:max-w-md gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                <input
                  type="text"
                  placeholder="Tìm kiếm thông minh..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none ring-blue-500/20 transition-all focus:border-blue-500 focus:ring-4 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:ring-blue-900/20"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                />
                
                {/* Search Suggestions Dropdown */}
                <AnimatePresence>
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                        Gợi ý kết quả
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {searchSuggestions.map((asset) => (
                          <button
                            key={asset.id}
                            onClick={() => {
                              setSelectedAsset(asset);
                              setShowSuggestions(false);
                              setSearchTerm('');
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          >
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              asset.type === 'fixed' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}>
                              <Package size={16} />
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{asset.name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{asset.code} • {asset.type === 'fixed' ? 'TSCĐ' : 'CCDC'}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Backdrop to close suggestions */}
                {showSuggestions && searchSuggestions.length > 0 && (
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowSuggestions(false)}
                  />
                )}
              </div>
              <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-95 dark:bg-slate-800 dark:hover:bg-slate-700">
                Tìm kiếm
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                <Filter size={18} />
                Bộ lọc
              </button>
              <div className="h-8 w-px bg-slate-200 mx-2 hidden sm:block dark:bg-slate-800" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Hiển thị <span className="font-semibold text-slate-900 dark:text-white">{filteredAssets.length}</span> tài sản
              </p>
            </div>
          </div>
        </div>

        {/* Table Container */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {activeTab === 'inventory' ? (
            <div className="space-y-6">
              {!isInventorying ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
                    <ClipboardCheck size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Kiểm kê định kỳ</h2>
                  <p className="mx-auto mt-2 max-w-md text-slate-500 dark:text-slate-400">
                    Bắt đầu phiên kiểm kê mới để cập nhật trạng thái thực tế của tất cả tài sản trong phòng X-Quang.
                  </p>
                  <div className="mt-8 flex justify-center gap-4">
                    <button
                      onClick={startInventory}
                      className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-700 active:scale-95 dark:shadow-indigo-900/20"
                    >
                      Bắt đầu kiểm kê mới
                    </button>
                  </div>

                  {inventoryLogs.length > 0 && (
                    <div className="mt-12 text-left">
                      <h3 className="mb-4 font-bold text-slate-900 dark:text-white">Nhật ký kiểm kê gần đây</h3>
                      <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                            <tr>
                              <th className="px-6 py-3">Ngày thực hiện</th>
                              <th className="px-6 py-3">Người thực hiện</th>
                              <th className="px-6 py-3">Tổng số tài sản</th>
                              <th className="px-6 py-3 text-right">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {inventoryLogs.slice().reverse().map(log => (
                              <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                                <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200">{new Date(log.date).toLocaleDateString('vi-VN')}</td>
                                <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{log.performedBy}</td>
                                <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{log.items.length} thiết bị</td>
                                <td className="px-6 py-4 text-right">
                                  <button 
                                    onClick={() => handlePrintInventory(log)}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                                  >
                                    <Printer size={14} />
                                    In báo cáo
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50/50 p-6 dark:border-indigo-900/30 dark:bg-indigo-900/10">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white">
                        <ClipboardCheck size={24} />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Đang thực hiện kiểm kê</h2>
                        <div className="mt-1 flex items-center gap-3">
                          <p className="text-sm text-slate-600 dark:text-slate-400">Ngày kiểm kê:</p>
                          <input 
                            type="date" 
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            value={inventoryDate}
                            onChange={(e) => setInventoryDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setIsInventorying(false)}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        Hủy bỏ
                      </button>
                      <button
                        onClick={finishInventory}
                        className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-700 dark:shadow-indigo-900/20"
                      >
                        Hoàn tất & Lưu
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                        <tr>
                          <th className="px-6 py-4">Tài sản</th>
                          <th className="px-6 py-4">Trạng thái thực tế</th>
                          <th className="px-6 py-4">Ghi chú kiểm kê</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {currentInventory.map(item => {
                          const asset = assets.find(a => a.id === item.assetId);
                          if (!asset) return null;
                          return (
                            <tr key={item.assetId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                              <td className="px-6 py-4">
                                <p className="font-bold text-slate-900 dark:text-slate-200">{asset.name}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider dark:text-slate-500">{asset.code}</p>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex gap-2">
                                  {[
                                    { id: 'ok', label: 'Đủ', color: 'peer-checked:bg-emerald-500 peer-checked:text-white text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20' },
                                    { id: 'missing', label: 'Thiếu', color: 'peer-checked:bg-rose-500 peer-checked:text-white text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/20' },
                                    { id: 'damaged', label: 'Hỏng', color: 'peer-checked:bg-amber-500 peer-checked:text-white text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20' }
                                  ].map(status => (
                                    <label key={status.id} className="relative cursor-pointer">
                                      <input
                                        type="radio"
                                        name={`status-${item.assetId}`}
                                        className="peer hidden"
                                        checked={item.status === status.id}
                                        onChange={() => updateInventoryStatus(item.assetId, status.id as any, item.note)}
                                      />
                                      <span className={`inline-block rounded-lg px-3 py-1 text-xs font-bold transition-all ${status.color}`}>
                                        {status.label}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <input
                                  type="text"
                                  placeholder="Nhập ghi chú (nếu có)..."
                                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                  value={item.note}
                                  onChange={(e) => updateInventoryStatus(item.assetId, item.status, e.target.value)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'history' ? (
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Nhật ký hoạt động hệ thống</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Tổng cộng {globalHistory.length} bản ghi</p>
              </div>
              <div className="space-y-4">
                {globalHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50/30 p-4 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/20 dark:hover:bg-slate-800/40">
                    <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      entry.type === 'damage' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' :
                      entry.type === 'repair' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      entry.type === 'liquidate' ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300' :
                      'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                      {entry.type === 'damage' && <AlertCircle size={20} />}
                      {entry.type === 'repair' && <Wrench size={20} />}
                      {entry.type === 'liquidate' && <Ban size={20} />}
                      {entry.type === 'update' && <Edit2 size={20} />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-slate-900 dark:text-white">
                          {entry.type === 'damage' ? 'Báo hỏng' :
                           entry.type === 'repair' ? 'Sửa chữa' :
                           entry.type === 'liquidate' ? 'Thanh lý' :
                           'Cập nhật'}
                        </p>
                        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{new Date(entry.date).toLocaleDateString('vi-VN')}</span>
                      </div>
                      <p className="text-sm text-slate-600 mb-1 dark:text-slate-400">{entry.description}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded dark:bg-blue-900/30 dark:text-blue-400">{entry.assetCode}</span>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-500">{entry.assetName}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {/* Desktop Table View */}
              <div className="hidden lg:block overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50">
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Mã tài sản</th>
                  <th className="min-w-[300px] px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Tên tài sản</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-center dark:text-slate-300">Phân loại</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-center dark:text-slate-300">Ngày bắt đầu</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-center dark:text-slate-300">ĐVT</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-center dark:text-slate-300">SL</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-right dark:text-slate-300">Tổng giá trị</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-right dark:text-slate-300">Số còn lại</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 text-center dark:text-slate-300">Lịch sử</th>
                  <th className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Ghi chú</th>
                  <th className="px-6 py-4 font-semibold text-slate-700 text-right dark:text-slate-300">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <AnimatePresence mode='popLayout'>
                  {filteredAssets.map((asset) => (
                    <motion.tr
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      key={asset.id}
                      className="group transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-6 py-4 font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{asset.code}</td>
                      <td className="px-6 py-4">
                        <button 
                          onClick={() => setSelectedAsset(asset)}
                          className="flex flex-col text-left group/name"
                        >
                          <span className="font-medium text-slate-900 line-clamp-2 group-hover/name:text-blue-600 transition-colors underline-offset-2 hover:underline dark:text-slate-200 dark:group-hover/name:text-blue-400">{asset.name}</span>
                        </button>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          asset.type === 'fixed' 
                            ? 'bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800' 
                            : 'bg-slate-50 text-slate-600 border border-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        }`}>
                          {asset.type === 'fixed' ? 'TSCĐ' : 'CCDC'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-slate-500 dark:text-slate-400">
                        {new Date(asset.dateAdded).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          {asset.unit}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-semibold text-slate-900 dark:text-slate-200">
                        {asset.quantityRemaining}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-slate-900 dark:text-slate-200">
                        {formatCurrency(asset.totalValue)}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(asset.remainingAmount)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button 
                          onClick={() => setViewingHistoryAsset(asset)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-all hover:bg-blue-50 hover:text-blue-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                        >
                          <History size={14} />
                          Lịch sử ({asset.history.length})
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        {asset.notes && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                            <AlertCircle size={12} />
                            {asset.notes}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!asset.liquidatedDate && (
                            <>
                              <button 
                                onClick={() => setEditingAsset(asset)}
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:text-slate-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                                title="Chỉnh sửa"
                              >
                                <Edit2 size={16} />
                              </button>
                              {asset.notes.toLowerCase().includes('hỏng') ? (
                                <button 
                                  onClick={() => handleRepair(asset.id)}
                                  className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                                  title="Đánh dấu đã sửa chữa"
                                >
                                  Sửa chữa
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleLiquidate(asset.id)}
                                  className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50"
                                  title="Thanh lý"
                                >
                                  Thanh lý
                                </button>
                              )}
                            </>
                          )}
                          {asset.liquidatedDate && (
                            <span className="text-xs font-bold text-slate-400 uppercase dark:text-slate-500">Đã thanh lý</span>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden divide-y divide-slate-100">
            {filteredAssets.map((asset) => (
              <div key={asset.id} className="p-4 space-y-3 bg-white hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{asset.code}</span>
                      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        asset.type === 'fixed' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-600'
                      }`}>
                        {asset.type === 'fixed' ? 'TSCĐ' : 'CCDC'}
                      </span>
                    </div>
                    <h3 
                      onClick={() => setSelectedAsset(asset)}
                      className="font-bold text-slate-900 leading-tight cursor-pointer hover:text-blue-600"
                    >
                      {asset.name}
                    </h3>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-sm font-bold text-emerald-600">{formatCurrency(asset.remainingAmount)}</span>
                    <div className="flex gap-1">
                      {!asset.liquidatedDate && (
                        <>
                          <button 
                            onClick={() => setEditingAsset(asset)}
                            className="rounded-lg p-2 text-slate-400 bg-slate-50 hover:text-blue-600"
                          >
                            <Edit2 size={16} />
                          </button>
                          {asset.notes.toLowerCase().includes('hỏng') ? (
                            <button 
                              onClick={() => handleRepair(asset.id)}
                              className="rounded-lg bg-emerald-50 p-2 text-emerald-600"
                            >
                              <Wrench size={16} />
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleLiquidate(asset.id)}
                              className="rounded-lg bg-rose-50 p-2 text-rose-600"
                            >
                              <Ban size={16} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-3">
                    <span>SL: <span className="font-bold text-slate-900">{asset.quantityRemaining}</span></span>
                    <span>ĐVT: <span className="font-medium text-slate-700">{asset.unit}</span></span>
                  </div>
                  <button 
                    onClick={() => setViewingHistoryAsset(asset)}
                    className="flex items-center gap-1 font-bold text-blue-600"
                  >
                    <History size={12} />
                    Lịch sử ({asset.history.length})
                  </button>
                </div>
                {asset.notes && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                    <AlertCircle size={14} />
                    {asset.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
          )}
          
          {activeTab !== 'history' && filteredAssets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="mb-4 rounded-full bg-slate-100 p-4 text-slate-400">
                {activeTab === 'damaged' ? <CheckCircle2 size={32} /> : <Search size={32} />}
              </div>
              <p className="text-lg font-medium text-slate-900">
                {activeTab === 'damaged' ? 'Tuyệt vời! Không có tài sản nào bị hỏng' : 'Không tìm thấy tài sản nào'}
              </p>
              <p className="text-sm text-slate-500">
                {activeTab === 'damaged' ? 'Tất cả thiết bị đang hoạt động tốt' : 'Thử thay đổi từ khóa tìm kiếm của bạn'}
              </p>
            </div>
          )}
        </div>
      </div>
    )}
  </main>

      {/* Asset Detail Modal */}
      <AnimatePresence>
        {selectedAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedAsset(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col md:flex-row h-[85vh] md:h-auto max-h-[90vh] dark:bg-slate-900"
            >
              {/* Left Side: Info */}
              <div className="flex-1 overflow-y-auto p-8 border-r border-slate-100 dark:border-slate-800">
                <div className="mb-8 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg ${
                      selectedAsset.type === 'fixed' ? 'bg-indigo-600 text-white shadow-indigo-200 dark:shadow-indigo-900/20' : 'bg-slate-800 text-white shadow-slate-200 dark:bg-slate-700 dark:shadow-slate-900/20'
                    }`}>
                      <Package size={32} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-900 leading-tight dark:text-white">{selectedAsset.name}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">{selectedAsset.code}</span>
                        <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                        <span className="text-xs font-bold text-slate-500 uppercase dark:text-slate-500">{selectedAsset.type === 'fixed' ? 'Tài sản cố định' : 'Công cụ dụng cụ'}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedAsset(null)}
                    className="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 md:hidden dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Ngày bắt đầu</p>
                    <p className="text-sm font-bold text-slate-700 flex items-center gap-2 dark:text-slate-300">
                      <Calendar size={16} className="text-slate-400 dark:text-slate-500" />
                      {new Date(selectedAsset.dateAdded).toLocaleDateString('vi-VN')}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Đơn vị tính</p>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{selectedAsset.unit}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Số lượng hiện có</p>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{selectedAsset.quantityRemaining}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Trạng thái</p>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                      selectedAsset.liquidatedDate ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' :
                      selectedAsset.notes.toLowerCase().includes('hỏng') ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' :
                      'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                    }`}>
                      <div className={`h-1.5 w-1.5 rounded-full ${
                        selectedAsset.liquidatedDate ? 'bg-slate-400 dark:bg-slate-500' :
                        selectedAsset.notes.toLowerCase().includes('hỏng') ? 'bg-rose-500' :
                        'bg-emerald-500'
                      }`} />
                      {selectedAsset.liquidatedDate ? 'Đã thanh lý' :
                       selectedAsset.notes.toLowerCase().includes('hỏng') ? 'Đang hỏng' :
                       'Đang hoạt động'}
                    </span>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl bg-slate-50 p-6 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Thông tin tài chính</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 dark:text-slate-400">Tổng giá trị</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{formatCurrency(selectedAsset.totalValue)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 dark:text-slate-400">Đã phân bổ</span>
                      <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{formatCurrency(selectedAsset.allocatedAmount)}</span>
                    </div>
                    <div className="h-px bg-slate-200 dark:bg-slate-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">Giá trị còn lại</span>
                      <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedAsset.remainingAmount)}</span>
                    </div>
                  </div>
                </div>

                {selectedAsset.notes && (
                  <div className="mt-6 space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Ghi chú</h3>
                    <p className="text-sm text-slate-600 italic bg-amber-50 p-3 rounded-xl border border-amber-100 dark:bg-amber-900/10 dark:border-amber-900/30 dark:text-amber-400">"{selectedAsset.notes}"</p>
                  </div>
                )}
                
                <div className="mt-8 flex gap-3">
                  <button 
                    onClick={() => {
                      setEditingAsset(selectedAsset);
                      setSelectedAsset(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 dark:shadow-blue-900/20"
                  >
                    <Edit2 size={18} />
                    Chỉnh sửa
                  </button>
                  <button 
                    onClick={() => setSelectedAsset(null)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Đóng
                  </button>
                </div>
              </div>

              {/* Right Side: Timeline History */}
              <div className="w-full md:w-[380px] bg-slate-50/50 flex flex-col h-full overflow-hidden dark:bg-slate-800/30">
                <div className="p-6 border-b border-slate-100 bg-white flex items-center justify-between dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <History size={18} className="text-amber-600 dark:text-amber-500" />
                    <h3 className="font-bold text-slate-900 dark:text-white">Lịch sử hoạt động</h3>
                  </div>
                  <button 
                    onClick={() => setSelectedAsset(null)}
                    className="hidden md:block rounded-lg p-1 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="relative space-y-6 before:absolute before:left-3 before:top-2 before:h-[calc(100%-16px)] before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                    {selectedAsset.history.slice().reverse().map((entry) => (
                      <div key={entry.id} className="relative pl-8">
                        <div className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-sm dark:border-slate-900 ${
                          entry.type === 'damage' ? 'bg-rose-500' :
                          entry.type === 'repair' ? 'bg-emerald-500' :
                          entry.type === 'liquidate' ? 'bg-slate-900 dark:bg-slate-700' :
                          'bg-blue-500'
                        }`}>
                          {entry.type === 'damage' && <AlertCircle size={10} className="text-white" />}
                          {entry.type === 'repair' && <Wrench size={10} className="text-white" />}
                          {entry.type === 'liquidate' && <Ban size={10} className="text-white" />}
                          {entry.type === 'update' && <Edit2 size={10} className="text-white" />}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider dark:text-slate-500">{new Date(entry.date).toLocaleDateString('vi-VN')}</p>
                          <p className="text-xs font-bold text-slate-900 mt-0.5 dark:text-slate-200">
                            {entry.type === 'damage' ? 'Báo hỏng' :
                             entry.type === 'repair' ? 'Sửa chữa' :
                             entry.type === 'liquidate' ? 'Thanh lý' :
                             'Cập nhật'}
                          </p>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed dark:text-slate-400">{entry.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {viewingHistoryAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingHistoryAsset(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <History size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Lịch sử tài sản</h2>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{viewingHistoryAsset.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setViewingHistoryAsset(null)}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-6">
                <div className="relative space-y-8 before:absolute before:left-4 before:top-2 before:h-[calc(100%-16px)] before:w-0.5 before:bg-slate-100 dark:before:bg-slate-800">
                  {viewingHistoryAsset.history.slice().reverse().map((entry, idx) => (
                    <div key={entry.id} className="relative pl-10">
                      <div className={`absolute left-0 top-1.5 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white shadow-sm dark:border-slate-900 ${
                        entry.type === 'damage' ? 'bg-rose-500' :
                        entry.type === 'repair' ? 'bg-emerald-500' :
                        entry.type === 'liquidate' ? 'bg-slate-900 dark:bg-slate-700' :
                        'bg-blue-500'
                      }`}>
                        {entry.type === 'damage' && <AlertCircle size={14} className="text-white" />}
                        {entry.type === 'repair' && <Wrench size={14} className="text-white" />}
                        {entry.type === 'liquidate' && <Ban size={14} className="text-white" />}
                        {entry.type === 'update' && <Edit2 size={14} className="text-white" />}
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/20">
                        <div className="mb-1 flex items-center justify-between">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${
                            entry.type === 'damage' ? 'text-rose-600 dark:text-rose-400' :
                            entry.type === 'repair' ? 'text-emerald-600 dark:text-emerald-400' :
                            entry.type === 'liquidate' ? 'text-slate-900 dark:text-slate-200' :
                            'text-blue-600 dark:text-blue-400'
                          }`}>
                            {entry.type === 'damage' ? 'Hư hỏng' :
                             entry.type === 'repair' ? 'Sửa chữa' :
                             entry.type === 'liquidate' ? 'Thanh lý' :
                             'Cập nhật'}
                          </span>
                          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                            {new Date(entry.date).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{entry.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-slate-100 p-4 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50">
                <button
                  onClick={() => setViewingHistoryAsset(null)}
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white transition-all hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
                >
                  Đóng
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add New Modal */}
      <AnimatePresence>
        {isAddingNew && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingNew(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Thêm tài sản mới</h2>
                <button 
                  onClick={() => setIsAddingNew(false)}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateAsset} className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Mã tài sản</label>
                    <input
                      required
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.code || ''}
                      onChange={e => setNewAsset({ ...newAsset, code: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Phân loại</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.type}
                      onChange={e => setNewAsset({ ...newAsset, type: e.target.value as AssetType })}
                    >
                      <option value="fixed">Tài sản cố định</option>
                      <option value="tool">Công cụ dụng cụ</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tên tài sản</label>
                  <input
                    required
                    type="text"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                    value={newAsset.name || ''}
                    onChange={e => setNewAsset({ ...newAsset, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ngày bắt đầu sử dụng</label>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.dateAdded}
                      onChange={e => setNewAsset({ ...newAsset, dateAdded: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Đơn vị tính</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.unit}
                      onChange={e => setNewAsset({ ...newAsset, unit: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Giá trị gốc (VND)</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.totalValue}
                      onChange={e => {
                        const totalValue = Number(e.target.value);
                        setNewAsset({ 
                          ...newAsset, 
                          totalValue, 
                          remainingAmount: totalValue - (newAsset.allocatedAmount || 0) 
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Giá trị đã phân bổ (VND)</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.allocatedAmount || 0}
                      onChange={e => {
                        const allocatedAmount = Number(e.target.value);
                        setNewAsset({ 
                          ...newAsset, 
                          allocatedAmount, 
                          remainingAmount: (newAsset.totalValue || 0) - allocatedAmount 
                        });
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Số lượng</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={newAsset.quantityAdded}
                      onChange={e => setNewAsset({ ...newAsset, quantityAdded: Number(e.target.value), quantityRemaining: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ghi chú</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                    rows={2}
                    value={newAsset.notes}
                    onChange={e => setNewAsset({ ...newAsset, notes: e.target.value })}
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsAddingNew(false)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 dark:shadow-blue-900/20"
                  >
                    Tạo tài sản
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingAsset(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Chỉnh sửa thông tin tài sản</h2>
                <button 
                  onClick={() => setEditingAsset(null)}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Mã tài sản</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={editingAsset.code}
                      onChange={e => setEditingAsset({ ...editingAsset, code: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Phân loại</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={editingAsset.type}
                      onChange={e => setEditingAsset({ ...editingAsset, type: e.target.value as AssetType })}
                    >
                      <option value="fixed">Tài sản cố định</option>
                      <option value="tool">Công cụ dụng cụ</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tên tài sản</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                    value={editingAsset.name}
                    onChange={e => setEditingAsset({ ...editingAsset, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ngày bắt đầu sử dụng</label>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={editingAsset.dateAdded}
                      onChange={e => setEditingAsset({ ...editingAsset, dateAdded: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Đơn vị tính</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={editingAsset.unit}
                      onChange={e => setEditingAsset({ ...editingAsset, unit: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Giá trị gốc (VND)</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={editingAsset.totalValue}
                      onChange={e => {
                        const totalValue = Number(e.target.value);
                        setEditingAsset({ 
                          ...editingAsset, 
                          totalValue,
                          remainingAmount: totalValue - editingAsset.allocatedAmount
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Giá trị đã phân bổ (VND)</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                      value={editingAsset.allocatedAmount}
                      onChange={e => {
                        const allocatedAmount = Number(e.target.value);
                        setEditingAsset({ 
                          ...editingAsset, 
                          allocatedAmount,
                          remainingAmount: editingAsset.totalValue - allocatedAmount
                        });
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ghi chú</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-blue-500"
                    rows={2}
                    value={editingAsset.notes}
                    onChange={e => {
                      const notes = e.target.value;
                      const isDamaged = notes.toLowerCase().includes('hỏng');
                      const wasDamaged = editingAsset.notes.toLowerCase().includes('hỏng');
                      
                      let newHistory = [...editingAsset.history];
                      if (isDamaged && !wasDamaged) {
                        newHistory.push({
                          id: Math.random().toString(36).substr(2, 9),
                          date: new Date().toISOString().split('T')[0],
                          type: 'damage',
                          description: 'Đánh dấu hỏng hóc qua ghi chú'
                        });
                      }

                      setEditingAsset({ 
                        ...editingAsset, 
                        notes,
                        history: newHistory
                      });
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDelete(editingAsset.id)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-600 transition-all hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/40"
                  >
                    <Trash2 size={18} />
                    <span className="hidden sm:inline">Xóa tài sản</span>
                  </button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setEditingAsset(null)}
                    className="rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-blue-600 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 dark:shadow-blue-900/20"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isConfirmingDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConfirmingDelete(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                <AlertCircle size={24} />
              </div>
              <h3 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">Xác nhận xóa tài sản?</h3>
              <p className="mb-6 text-sm text-slate-500 leading-relaxed dark:text-slate-400">
                Hành động này không thể hoàn tác. Tất cả dữ liệu và lịch sử của tài sản này sẽ bị xóa vĩnh viễn khỏi hệ thống.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsConfirmingDelete(null)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Hủy
                </button>
                <button
                  onClick={() => handleDeleteAsset(isConfirmingDelete)}
                  className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white shadow-lg shadow-rose-200 transition-all hover:bg-rose-700 dark:shadow-rose-900/20"
                >
                  Xác nhận xóa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className={`fixed bottom-8 left-1/2 z-[100] flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white shadow-2xl ${
              toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <footer className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-8 sm:flex-row dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
            <FileText size={16} />
            <span className="text-xs font-medium uppercase tracking-widest">Hệ thống quản lý tài sản v1.0</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-600">
            © 2024 Phòng X-Quang. Tất cả quyền được bảo lưu.
          </p>
        </div>
      </footer>
      </div>
    </ErrorBoundary>
  );
}
