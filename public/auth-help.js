export function parseFirebaseConfig(text) {
  let input = text.trim().replace(/^(?:const|let|var)\s+firebaseConfig\s*=\s*/, '').replace(/;\s*$/, '');
  // Accept Firebase Console's object literal without evaluating JavaScript.
  input = input.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1');
  let config;
  try { config = JSON.parse(input); } catch { throw Error('Firebase config chưa đúng. Sao chép đối tượng firebaseConfig từ Firebase Console; không dán toàn bộ đoạn mã cài SDK.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Firebase config phải là một đối tượng cấu hình.');
  if (config.private_key || config.type === 'service_account') throw Error('Không nhập khóa service-account vào app. Chỉ dùng Firebase Web config.');
  for (const key of ['apiKey', 'projectId', 'storageBucket', 'appId']) {
    if (typeof config[key] !== 'string' || !config[key].trim() || /^[.…]+$/.test(config[key].trim())) throw Error('Firebase config thiếu giá trị thật cho ' + key + '. Lấy trong Firebase Console → Project settings → Your apps → Web app.');
  }
  return config;
}

export function loginError(error) {
  const help = {
    'auth/email-already-in-use': 'Email này đã có tài khoản. Bấm Đăng nhập bằng mật khẩu đã tạo.',
    'auth/weak-password': 'Mật khẩu chưa đạt yêu cầu của Firebase. Dùng ít nhất 6 ký tự và đáp ứng chính sách mật khẩu của project.',
    'auth/password-does-not-meet-requirements': 'Mật khẩu chưa đạt chính sách của Firebase project. Hãy dùng mật khẩu mạnh hơn.',
    'auth/invalid-credential': 'Email hoặc mật khẩu chưa đúng, hoặc tài khoản không thuộc Firebase project đã cấu hình.',
    'auth/wrong-password': 'Email hoặc mật khẩu chưa đúng.',
    'auth/user-not-found': 'Chưa tìm thấy tài khoản. Tạo tài khoản trong Firebase Console → Authentication → Users → Add user.',
    'auth/invalid-email': 'Email chưa đúng định dạng.',
    'auth/operation-not-allowed': 'Firebase chưa bật Email/Password. Vào Authentication → Sign-in method để bật.',
    'auth/configuration-not-found': 'Firebase project chưa thiết lập Authentication. Mở Authentication → Get started và bật Email/Password.',
    'auth/invalid-api-key': 'API key chưa đúng. Kiểm tra Firebase Web config của đúng project.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'API key chưa đúng. Sao chép lại Firebase Web config từ project của nhóm.',
    'auth/unauthorized-domain': 'Tên miền hiện tại chưa được cho phép trong Firebase Authentication → Settings → Authorized domains.',
    'auth/network-request-failed': 'Không kết nối được Firebase. Kiểm tra Internet hoặc tiện ích đang chặn kết nối.',
    'auth/too-many-requests': 'Firebase tạm hạn chế đăng nhập do quá nhiều lần thử. Vui lòng đợi rồi thử lại.',
    'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hóa trong Firebase.',
    'auth/web-storage-unsupported': 'Trình duyệt đang chặn bộ nhớ đăng nhập. Cho phép dữ liệu trang hoặc dùng cửa sổ thông thường.'
  };
  return (help[error?.code] || error?.message || 'Chưa đăng nhập được.') + (error?.code ? ` [${error.code}]` : '');
}
