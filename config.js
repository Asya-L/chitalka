// Синхронизация: адрес проекта Supabase и публичный (publishable) ключ.
// Публичный ключ можно хранить открыто: данные защищены правилами доступа в базе (schema.sql).
// Секретный ключ сюда не вписывать.
window.APP_CONFIG = {
  supabaseUrl: 'https://lvdjvywgqzkovbmwytbe.supabase.co',
  supabaseKey: 'sb_publishable_MroiCpgbn6OMexul2JnOLw_te_FKJJK',
  // публичный ключ VAPID для push-уведомлений (секретная половина — только в настройках функции remind)
  vapidPublicKey: 'BEn1XH0g4NYsZovvgLccoqlQFEck4qPtolePNK47QENmJFlz0TkaNsXJiKGQRvL5Ynl8wOdrQUUZyeGt3_Qwk10'
};
