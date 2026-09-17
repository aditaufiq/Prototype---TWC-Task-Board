export const DIVISIONS = [
  { id: 'pir', name: 'Product Innovation & Research', color: '#0F766E' },
  { id: 'mkt', name: 'Marketing & Digital', color: '#E2583E' },
  { id: 'ops', name: 'Operations', color: '#C7861B' },
  { id: 'gx',  name: 'Guest Experience', color: '#6E59A5' },
  { id: 'fin', name: 'Finance & Admin', color: '#3B5BA5' },
];

export const DEFAULT_PRODUCTS = {
  pir: ['Wastra', 'Ticket Bundling', 'Research & Insights'],
  mkt: ['Social Media', 'Digital Campaign'],
  ops: ['Visitor Flow', 'Operations'],
  gx: ['Visitor Experience', 'Survey & Feedback'],
  fin: ['Budget & Reporting']
};

export const STATUSES = [
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'In Review' },
  { id: 'done', name: 'Done' },
];

export const PRIORITY_COLOR = {
  high: 'var(--high)',
  medium: 'var(--medium)',
  low: 'var(--low)'
};

export const PRIORITY_LABEL = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

export const STATUS_LABEL = {
  todo: 'To Do',
  progress: 'In Progress',
  review: 'In Review',
  done: 'Done'
};

export const DEFAULT_MEMBERS = [
  { id: 'adit', name: 'Adit', email: 'adit@twc.local', color: '#E85D9E', role: 'member', active: true },
  { id: 'tata', name: 'Tata', email: 'tata@twc.local', color: '#E8B93D', role: 'admin', active: true },
  { id: 'rafi', name: 'Rafi', email: 'rafi@twc.local', color: '#4C9BE8', role: 'member', active: true },
  { id: 'dini', name: 'Dini', email: 'dini@twc.local', color: '#5FBF7A', role: 'member', active: true },
];

export const SEED = [
  { id: 1, title: 'Riset preferensi wisatawan domestik 2026', description: 'Kumpulkan data preferensi wisatawan domestik dari survei Q2-Q3 untuk input strategi produk baru.', division: 'pir', assignee: 'adit', priority: 'high', due: '2026-09-20', status: 'progress', product: 'Research & Insights' },
  { id: 2, title: 'Prototipe tiket bundling 3 candi', description: 'Rancang skema harga dan alur pembelian tiket bundling Borobudur-Prambanan-Ratu Boko.', division: 'pir', assignee: 'rafi', priority: 'medium', due: '2026-09-25', status: 'todo', product: 'Ticket Bundling' },
  { id: 3, title: 'Kampanye konten Instagram sunrise tour', description: 'Buat rangkaian konten foto & video untuk promosi paket sunrise tour bulan depan.', division: 'mkt', assignee: 'dini', priority: 'medium', due: '2026-09-18', status: 'progress', product: 'Social Media' },
  { id: 4, title: 'Evaluasi alur antrian loket weekend', description: 'Amati dan catat titik-titik penumpukan antrian loket saat akhir pekan, usulkan perbaikan alur.', division: 'ops', assignee: 'tata', priority: 'high', due: '2026-09-15', status: 'review', product: 'Visitor Flow' },
  { id: 5, title: 'Survei kepuasan pengunjung Q3', description: 'Sebar kuesioner kepuasan pengunjung dan rekap hasilnya jadi laporan ringkas.', division: 'gx', assignee: 'adit', priority: 'low', due: '2026-09-30', status: 'todo', product: 'Survey & Feedback' },
  { id: 6, title: 'Rekap anggaran promosi bulan lalu', description: 'Kumpulkan bukti pengeluaran promosi bulan lalu dan susun rekap ke format laporan bulanan.', division: 'fin', assignee: 'rafi', priority: 'low', due: '2026-09-10', status: 'done', product: 'Budget & Reporting' },
  { id: 7, title: 'Analisis data kunjungan musim liburan', description: 'Olah data jumlah kunjungan selama musim liburan untuk melihat tren dibanding tahun lalu.', division: 'pir', assignee: 'adit', priority: 'medium', due: '2026-09-28', status: 'todo', product: 'Research & Insights' },
];
