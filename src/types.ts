export interface HistoryEntry {
  id: string;
  date: string;
  type: 'damage' | 'repair' | 'liquidate' | 'update' | 'inventory';
  description: string;
}

export interface InventoryLog {
  id: string;
  date: string;
  items: {
    assetId: string;
    assetName: string;
    assetCode: string;
    status: 'ok' | 'missing' | 'damaged';
    note: string;
  }[];
  performedBy: string;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  type: AssetType;
  dateAdded: string;
  unit: string;
  quantityAdded: number;
  quantityReduced: number;
  quantityRemaining: number;
  totalValue: number;
  allocatedAmount: number;
  remainingAmount: number;
  inventoryCount: number;
  notes: string;
  history: HistoryEntry[];
  liquidatedDate?: string;
  transferredDate?: string;
}

export type AssetType = 'fixed' | 'tool';

export type UserRole = 'admin' | 'user';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  status: 'active' | 'pending' | 'disabled';
  createdAt: string;
}
