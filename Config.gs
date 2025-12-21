/**
 * Golf Reservation Manager (GRM) - Config
 * 設定管理モジュール
 * 
 * すべての可変パラメータをConfigシートまたはPropertiesServiceで一元管理
 */

const Config = {
  // シート名
  SHEET_NAMES: {
    CONFIG: 'Config',
    RESERVATION_DB: 'Reservation_DB',
    MERGE_LOG: 'Merge_Log',
    TRANSACTION_LOG: 'Transaction_Log',
    ERROR_LOG: 'Error_Log',
    DICTIONARY: 'Dictionary'
  },

  /**
   * 設定値を取得
   * @param {string} key - 設定キー
   * @returns {string} 設定値
   */
  get(key) {
    // まずPropertiesServiceから取得を試みる
    const scriptProps = PropertiesService.getScriptProperties();
    let value = scriptProps.getProperty(key);
    
    if (value) return value;
    
    // なければConfigシートから取得
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(this.SHEET_NAMES.CONFIG);
    
    if (!configSheet) {
      throw new Error('Configシートが見つかりません');
    }
    
    const data = configSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        return data[i][1];
      }
    }
    
    return null;
  },

  /**
   * 設定値を保存
   * @param {string} key - 設定キー
   * @param {string} value - 設定値
   */
  set(key, value) {
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.setProperty(key, value);
  },

  /**
   * 全設定を取得
   * @returns {Object} 設定オブジェクト
   */
  getAll() {
    return {
      // メール関連
      GOLF_CLUB_EMAIL: this.get('GOLF_CLUB_EMAIL') || 'info-asakura@tokyu-rs.co.jp',
      ADMIN_EMAIL: this.get('ADMIN_EMAIL') || 'midorikawa@agentgate.jp',
      TEST_EMAIL: this.get('TEST_EMAIL') || 'midorikawa@ai-partner.co.jp',
      
      // カレンダー関連
      CALENDAR_ID: this.get('CALENDAR_ID') || 'midorikawa@agentgate.jp',
      
      // LINE関連
      LINE_ACCESS_TOKEN: this.get('LINE_ACCESS_TOKEN') || '',
      LINE_USER_ID: this.get('LINE_USER_ID') || '',
      
      // 天気API
      WEATHER_API_KEY: this.get('WEATHER_API_KEY') || '',
      GOLF_CLUB_LAT: this.get('GOLF_CLUB_LAT') || '35.7796',
      GOLF_CLUB_LON: this.get('GOLF_CLUB_LON') || '140.3126',
      
      // AI API
      AI_API_KEY: this.get('AI_API_KEY') || '',
      
      // システム設定
      REMINDER_DAYS: parseInt(this.get('REMINDER_DAYS')) || 8,
      IS_TEST_MODE: String(this.get('IS_TEST_MODE')).toLowerCase() === 'true',
      
      // 通知モード
      NOTIFICATION_MODE: this.get('NOTIFICATION_MODE') || 'hybrid' // 'line_only', 'web_only', 'hybrid'
    };
  },

  /**
   * テストモードかどうかを確認
   * @returns {boolean}
   */
  isTestMode() {
    const value = String(this.get('IS_TEST_MODE')).toLowerCase();
    return value === 'true';
  },

  /**
   * 送信先メールアドレスを取得（テストモード対応）
   * @returns {string}
   */
  getGolfClubEmail() {
    if (this.isTestMode()) {
      return this.get('TEST_EMAIL') || 'midorikawa@ai-partner.co.jp';
    }
    return this.get('GOLF_CLUB_EMAIL') || 'info-asakura@tokyu-rs.co.jp';
  }
};

/**
 * Configシートの初期化
 */
function initConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(Config.SHEET_NAMES.CONFIG);
  
  if (!configSheet) {
    configSheet = ss.insertSheet(Config.SHEET_NAMES.CONFIG);
    
    // ヘッダー設定
    configSheet.getRange('A1:C1').setValues([['Key', 'Value', 'Description']]);
    configSheet.getRange('A1:C1').setFontWeight('bold').setBackground('#4a4a4a');
    
    // 初期設定値
    const initialConfig = [
      ['GOLF_CLUB_EMAIL', 'info-asakura@tokyu-rs.co.jp', 'ゴルフ場メールアドレス'],
      ['ADMIN_EMAIL', 'midorikawa@agentgate.jp', '管理者メールアドレス'],
      ['TEST_EMAIL', 'midorikawa@ai-partner.co.jp', 'テスト用送信先'],
      ['CALENDAR_ID', 'midorikawa@agentgate.jp', 'Googleカレンダー ID'],
      ['LINE_ACCESS_TOKEN', '', 'LINE Messaging API トークン'],
      ['LINE_USER_ID', '', 'LINE 通知先ユーザーID'],
      ['WEATHER_API_KEY', '', '天気API キー'],
      ['GOLF_CLUB_LAT', '35.7796', 'ゴルフ場緯度（麻倉）'],
      ['GOLF_CLUB_LON', '140.3126', 'ゴルフ場経度（麻倉）'],
      ['AI_API_KEY', '', 'Generative AI API キー'],
      ['REMINDER_DAYS', '8', 'リマインダー日数'],
      ['IS_TEST_MODE', 'true', 'テストモード有効'],
      ['NOTIFICATION_MODE', 'hybrid', '通知モード (line_only/web_only/hybrid)']
    ];
    
    configSheet.getRange(2, 1, initialConfig.length, 3).setValues(initialConfig);
    configSheet.autoResizeColumns(1, 3);
  }
  
  return configSheet;
}
