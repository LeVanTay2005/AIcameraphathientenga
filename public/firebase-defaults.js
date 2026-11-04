import {parseFirebaseConfig} from './auth-help.js';

export async function loadFirebaseDefaults(fetcher = fetch) {
  const response = await fetcher('/firebase-config.json', {cache: 'no-store'});
  if (!response.ok) throw Error('Không tải được cấu hình Firebase tích hợp. Kiểm tra kết nối rồi tải lại trang.');
  return parseFirebaseConfig(JSON.stringify(await response.json()));
}
