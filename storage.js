const DB = 'word-recall-v1';
let connection;
function open() {
  return connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function load() {
  const db = await open(); return new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get('app');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function save(data) {
  const db = await open(); return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'app');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存が中断されました。'));
  });
}
