/**
 * Golf Reservation Manager (GRM) - BrainManager
 * メイン制御モジュール
 * 
 * 全Stageの統合管理とWebアプリエンドポイント
 */

/**
 * Web App エントリーポイント (GET)
 * action パラメータがある場合はAPIとして応答
 * ない場合はHTMLを返す
 */
function doGet(e) {
  const action = e.parameter.action;
  
  // APIリクエストの場合
  if (action) {
    return handleGetRequest(action, e.parameter);
  }
  
  // HTMLページを返す（テンプレートを評価）
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Golf Reservation Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}

/**
 * GET APIリクエスト処理
 */
function handleGetRequest(action, params) {
  let result;
  
  try {
    switch (action) {
      case 'getStats':
        result = BrainManager.getStats();
        break;
      case 'getReservations':
        result = BrainManager.getReservations();
        break;
      case 'getMergeCandidates':
        result = Merger.detectAllMergeCandidates();
        break;
      case 'getWeather':
        result = Weather.getWeatherForecast(params.date);
        break;
      case 'enableLine':
        enableLineNotification();
        result = { success: true, mode: 'hybrid' };
        break;
      case 'disableLine':
        disableLineNotification();
        result = { success: true, mode: 'web' };
        break;
      case 'getSettings':
        result = {
          lineEnabled: isLineEnabled(),
          mode: isLineEnabled() ? 'hybrid' : 'web'
        };
        break;
      case 'approveReservation':
        result = approveReservationToCalendar(params.id);
        break;
      case 'approveAllReservations':
        result = approveAllReservationsToCalendar();
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (error) {
    result = { error: error.message };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Web App エントリーポイント (POST)
 * APIリクエストとLINE Webhookの両方を処理
 */
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    
    // ========================================
    // LINE Webhook判定（events配列があればLINE）
    // ========================================
    if (request.events) {
      GRMLogger.info('LINE', 'Webhook受信', { eventCount: request.events.length });
      
      request.events.forEach(event => {
        handleLineEvent(event);
      });
      
      return ContentService.createTextOutput('OK');
    }
    
    // ========================================
    // 通常のAPIリクエスト
    // ========================================
    const action = request.action;
    const data = request.data || {};
    
    let result;
    
    switch (action) {
      // 予約関連
      case 'getReservations':
        result = BrainManager.getReservations();
        break;
      case 'getReservation':
        result = BrainManager.getReservation(data.id);
        break;
      case 'confirmReservation':
        result = BrainManager.confirmReservation(data.id);
        break;
      case 'cancelReservation':
        result = BrainManager.cancelReservation(data.id);
        break;
        
      // マージ関連
      case 'getMergeCandidates':
        result = Merger.detectAllMergeCandidates();
        break;
      case 'executeMerge':
        result = Merger.executeMerge(data.date);
        break;
      case 'executeAllMerges':
        result = Merger.executeAllMerges();
        break;
      case 'getMergeHistory':
        result = Merger.getMergeHistory(data.limit);
        break;
        
      // 天気関連
      case 'getWeather':
        result = Weather.getWeatherForecast(data.date);
        break;
        
      // 設定関連
      case 'getSettings':
        result = Config.getAll();
        break;
      case 'updateSetting':
        Config.set(data.key, data.value);
        result = { success: true };
        break;
        
      // 統計
      case 'getStats':
        result = BrainManager.getStats();
        break;
        
      default:
        result = { error: 'Unknown action' };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (e) {
    GRMLogger.error('API', 'APIエラー', { error: e.message });
    return ContentService.createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * メイン制御オブジェクト
 */
const BrainManager = {
  /**
   * 予約一覧を取得
   */
  getReservations() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dbSheet = ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB);
    
    if (!dbSheet) return [];
    
    const data = dbSheet.getDataRange().getValues();
    const reservations = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // 日付のフォーマット
      let dateStr = '';
      const dateValue = row[2];
      if (dateValue instanceof Date) {
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        dateStr = year + '-' + month + '-' + day;
      } else if (dateValue) {
        dateStr = String(dateValue);
      }
      
      // 時刻のフォーマット
      let timeStr = '';
      const timeValue = row[5];
      if (timeValue instanceof Date) {
        const hour = String(timeValue.getHours()).padStart(2, '0');
        const minute = String(timeValue.getMinutes()).padStart(2, '0');
        timeStr = hour + ':' + minute;
      } else if (timeValue) {
        timeStr = String(timeValue);
      }
      
      reservations.push({
        id: row[0],
        emailReceivedDate: row[1],
        date: dateStr,
        weekday: row[3],
        course: row[4],
        time: timeStr,
        status: row[6],
        calendarEventId: row[7],
        updatedAt: row[8],
        confidence: row[9],
        remainingSlots: 3 // デフォルト
      });
    }
    
    return reservations;
  },

  /**
   * 予約詳細を取得
   */
  getReservation(id) {
    const reservations = this.getReservations();
    return reservations.find(r => r.id === id) || null;
  },

  /**
   * 今後の予約を取得
   */
  getUpcomingReservations() {
    const reservations = this.getReservations();
    const today = new Date().toISOString().split('T')[0];
    
    return reservations
      .filter(r => r.date >= today && r.status !== 'cancelled')
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  /**
   * 予約を承認してカレンダーに登録
   */
  confirmReservation(id) {
    GRMLogger.info('Stage4', '予約承認開始', { id });
    
    try {
      const reservation = this.getReservation(id);
      if (!reservation) {
        throw new Error('予約が見つかりません');
      }
      
      // カレンダーに登録
      const eventId = GRMCalendar.createEvent(reservation);
      
      // DBを更新
      this.updateReservationStatus(id, 'confirmed', eventId);
      
      // マージ候補をチェック
      const mergeCandidates = Merger.detectMergeCandidates(reservation.date);
      if (mergeCandidates.canMerge) {
        GRMLogger.info('Stage6', 'マージ候補検出', { 
          date: reservation.date,
          childCount: mergeCandidates.children.length
        });
      }
      
      return { 
        success: true, 
        eventId,
        hasMergeCandidates: mergeCandidates.canMerge
      };
      
    } catch (e) {
      GRMLogger.error('Stage4', '予約承認エラー', { id, error: e.message });
      return { success: false, error: e.message };
    }
  },

  /**
   * 予約をキャンセル
   */
  cancelReservation(id) {
    GRMLogger.info('Stage5', 'キャンセル処理開始', { id });
    
    try {
      const reservation = this.getReservation(id);
      if (!reservation) {
        throw new Error('予約が見つかりません');
      }
      
      // キャンセルメール送信
      GRMMail.sendCancellationEmail(reservation);
      
      // カレンダーイベントをキャンセル
      if (reservation.calendarEventId) {
        GRMCalendar.cancelEvent(reservation.calendarEventId);
      }
      
      // DBを更新
      this.updateReservationStatus(id, 'cancelled', null);
      
      return { success: true };
      
    } catch (e) {
      GRMLogger.error('Stage5', 'キャンセル処理エラー', { id, error: e.message });
      return { success: false, error: e.message };
    }
  },

  /**
   * 予約ステータスを更新
   */
  updateReservationStatus(id, status, eventId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dbSheet = ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB);
    
    const data = dbSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === id) {
        dbSheet.getRange(i + 1, 7).setValue(status); // ステータス
        if (eventId !== undefined) {
          dbSheet.getRange(i + 1, 8).setValue(eventId || ''); // カレンダーEventID
        }
        dbSheet.getRange(i + 1, 9).setValue(new Date().toISOString()); // 最終更新
        break;
      }
    }
  },

  /**
   * 統計を取得
   */
  getStats() {
    const reservations = this.getReservations();
    const today = new Date().toISOString().split('T')[0];
    const upcoming = reservations.filter(r => r.date >= today && r.status !== 'cancelled');
    
    // リマインダー対象（8日前）
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + 8);
    const reminderDateStr = reminderDate.toISOString().split('T')[0];
    
    const needsReminder = upcoming.filter(r => 
      r.date <= reminderDateStr && r.status === 'confirmed'
    );
    
    // マージ待ち
    const mergeCandidates = Merger.detectAllMergeCandidates();
    
    return {
      total: reservations.length,
      upcoming: upcoming.length,
      confirmed: reservations.filter(r => r.status === 'confirmed').length,
      pending: reservations.filter(r => r.status === 'pending').length,
      cancelled: reservations.filter(r => r.status === 'cancelled').length,
      needsReminder: needsReminder.length,
      pendingMerge: mergeCandidates.length
    };
  },

  /**
   * Stage 5: リマインダー処理
   * 毎日 AM 08:00 にトリガーで実行
   */
  processReminders() {
    GRMLogger.info('Stage5', 'リマインダー処理開始');
    
    const reminderDays = Config.get('REMINDER_DAYS') || 8;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + reminderDays);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    const reservations = this.getUpcomingReservations()
      .filter(r => r.date === targetDateStr && r.status === 'confirmed');
    
    reservations.forEach(reservation => {
      // 天気情報を取得
      const weather = Weather.getWeatherForecast(reservation.date);
      
      // 通知を送信（LINE/Web）
      this.sendReminderNotification(reservation, weather);
      
      // ステータスを更新
      this.updateReservationStatus(reservation.id, 'reminder');
    });
    
    GRMLogger.info('Stage5', 'リマインダー処理完了', { 
      processedCount: reservations.length 
    });
  },

  /**
   * リマインダー通知を送信
   */
  sendReminderNotification(reservation, weather) {
    const notificationMode = Config.get('NOTIFICATION_MODE') || 'hybrid';
    
    // LINE通知
    if (notificationMode === 'line_only' || notificationMode === 'hybrid') {
      try {
        LINE.sendReminderNotification(reservation, weather);
        GRMLogger.info('Stage5', 'LINEリマインダー通知送信', { 
          reservationId: reservation.id 
        });
      } catch (e) {
        GRMLogger.error('Stage5', 'LINEリマインダー通知エラー', { error: e.message });
      }
    }
    
    // Web通知（将来的にはPush API等）
    if (notificationMode === 'web_only' || notificationMode === 'hybrid') {
      GRMLogger.info('Stage5', 'Web通知対象', { 
        reservationId: reservation.id 
      });
    }
  },

  /**
   * Stage 3: 予約確認通知
   */
  sendConfirmNotification(reservation) {
    const notificationMode = Config.get('NOTIFICATION_MODE') || 'hybrid';
    
    if (notificationMode === 'line_only' || notificationMode === 'hybrid') {
      try {
        LINE.sendReservationConfirmNotification(reservation);
        GRMLogger.info('Stage3', 'LINE予約確認通知送信', { 
          reservationId: reservation.id 
        });
      } catch (e) {
        GRMLogger.error('Stage3', 'LINE予約確認通知エラー', { error: e.message });
      }
    }
  },

  /**
   * Stage 6: マージ候補通知
   */
  sendMergeNotification(mergeInfo) {
    const notificationMode = Config.get('NOTIFICATION_MODE') || 'hybrid';
    
    if (notificationMode === 'line_only' || notificationMode === 'hybrid') {
      try {
        LINE.sendMergeNotification(mergeInfo);
        GRMLogger.info('Stage6', 'LINEマージ通知送信', { 
          date: mergeInfo.date 
        });
      } catch (e) {
        GRMLogger.error('Stage6', 'LINEマージ通知エラー', { error: e.message });
      }
    }
  }
};

/**
 * 初期化関数
 */
function initializeGRM() {
  // Configシートの初期化
  initConfigSheet();
  
  // 各シートの初期化
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Reservation_DB
  if (!ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB)) {
    Parser.initReservationDB(ss);
  }
  
  GRMLogger.info('System', 'GRM初期化完了');
  
  return { success: true, message: 'GRM initialized successfully' };
}

/**
 * トリガー設定
 */
function setupTriggers() {
  // 既存トリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  // Stage 0: 毎月1日 AM 03:00
  ScriptApp.newTrigger('triggerSendReservationRequest')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();
  
  // Stage 5: 毎日 AM 08:00
  ScriptApp.newTrigger('triggerProcessReminders')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  
  GRMLogger.info('System', 'トリガー設定完了');
  
  return { success: true };
}

/**
 * トリガー関数
 */
function triggerProcessReminders() {
  BrainManager.processReminders();
}

// ============================================
// テスト関数（GASエディタで直接実行可能）
// ============================================

/**
 * テスト1: システム統計を取得
 * GASエディタで「testGetStats」を選択して実行
 */
function testGetStats() {
  console.log('=== GRM 統計テスト ===');
  const stats = BrainManager.getStats();
  console.log('統計結果:', JSON.stringify(stats, null, 2));
  console.log('=== テスト完了 ===');
  return stats;
}

/**
 * テスト2: LINE通知を送信
 * GASエディタで「testLineNotification」を選択して実行
 */
function testLineNotification() {
  console.log('=== LINE通知テスト ===');
  const result = LINE.sendTextMessage('🏌️ GRMシステムテスト通知です！\n\nこのメッセージが届いていれば、LINE連携は正常です。');
  console.log('送信結果:', JSON.stringify(result));
  console.log('=== テスト完了 ===');
  return result;
}

/**
 * テスト3: 設定値を確認
 * GASエディタで「testConfig」を選択して実行
 */
function testConfig() {
  console.log('=== 設定値テスト ===');
  const config = Config.getAll();
  console.log('設定値:', JSON.stringify(config, null, 2));
  console.log('=== テスト完了 ===');
  return config;
}

/**
 * テスト4: 予約一覧を取得
 * GASエディタで「testGetReservations」を選択して実行
 */
function testGetReservations() {
  console.log('=== 予約一覧テスト ===');
  const reservations = BrainManager.getReservations();
  console.log('予約数:', reservations.length);
  console.log('予約データ:', JSON.stringify(reservations, null, 2));
  console.log('=== テスト完了 ===');
  return reservations;
}

/**
 * テスト5: 天気情報を取得
 * GASエディタで「testWeather」を選択して実行
 */
function testWeather() {
  console.log('=== 天気情報テスト ===');
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + 7);
  const dateStr = targetDate.toISOString().split('T')[0];
  
  const weather = Weather.getWeatherForecast(dateStr);
  console.log('対象日:', dateStr);
  console.log('天気:', JSON.stringify(weather, null, 2));
  console.log('=== テスト完了 ===');
  return weather;
}

/**
 * テスト6: 全機能テスト
 * GASエディタで「testAll」を選択して実行
 */
function testAll() {
  console.log('========================================');
  console.log('        GRM 全機能テスト開始');
  console.log('========================================\n');
  
  // 1. 設定確認
  console.log('【1】設定確認...');
  const config = testConfig();
  console.log('結果: ' + (config ? '✅ OK' : '❌ NG') + '\n');
  
  // 2. 統計取得
  console.log('【2】統計取得...');
  const stats = testGetStats();
  console.log('結果: ' + (stats ? '✅ OK' : '❌ NG') + '\n');
  
  // 3. 予約一覧
  console.log('【3】予約一覧...');
  const reservations = testGetReservations();
  console.log('結果: ✅ OK (' + reservations.length + '件)\n');
  
  // 4. 天気情報
  console.log('【4】天気情報...');
  const weather = testWeather();
  console.log('結果: ' + (weather ? '✅ OK' : '❌ NG') + '\n');
  
  console.log('========================================');
  console.log('        GRM 全機能テスト完了');
  console.log('========================================');
  
  return {
    config: !!config,
    stats: !!stats,
    reservations: reservations.length,
    weather: !!weather
  };
}

// ============================================
// ステップバイステップ テスト関数
// 1日の運用フローをシミュレート
// ============================================

/**
 * ★★★ テスト01: 設定確認 ★★★
 * 
 * 【説明】現在の設定を表示して、テストモードになっているか確認します
 * 【実行場所】GASエディタ → 関数選択「test01_CheckConfig」→ ▶実行
 */
function test01_CheckConfig() {
  console.log('========================================');
  console.log('  テスト01: 設定確認');
  console.log('========================================');
  
  const config = Config.getAll();
  
  console.log('');
  console.log('【現在の設定】');
  console.log('・ゴルフ場メール: ' + config.GOLF_CLUB_EMAIL);
  console.log('・管理者メール: ' + config.ADMIN_EMAIL);
  console.log('・テスト用メール: ' + config.TEST_EMAIL);
  console.log('・カレンダーID: ' + config.CALENDAR_ID);
  console.log('・テストモード: ' + (config.IS_TEST_MODE ? '✅ 有効（安全）' : '⚠️ 無効（本番）'));
  console.log('・LINE設定: ' + (config.LINE_ACCESS_TOKEN ? '✅ 設定済み' : '❌ 未設定'));
  console.log('');
  
  if (config.IS_TEST_MODE) {
    console.log('✅ テストモードなので、メールは ' + config.TEST_EMAIL + ' に送信されます');
  } else {
    console.log('⚠️ 本番モードです！メールは麻倉ゴルフ倶楽部に送信されます！');
  }
  
  console.log('');
  console.log('✅ テスト01完了 → 次は test02_SendRequestMail を実行');
  console.log('========================================');
  
  return config;
}

/**
 * ★★★ テスト02: 予約依頼メール送信 ★★★
 * 
 * 【説明】2026年4月の予約依頼メールを送信します
 *        テストモードなので midorikawa@ai-partner.co.jp に届きます
 * 【実行場所】GASエディタ → 関数選択「test02_SendRequestMail」→ ▶実行
 */
function test02_SendRequestMail() {
  console.log('========================================');
  console.log('  テスト02: 予約依頼メール送信');
  console.log('========================================');
  
  // テストモード確認
  if (!Config.isTestMode()) {
    console.log('⚠️ 本番モードです！中止しました。');
    console.log('Configシートで IS_TEST_MODE を true に設定してください');
    return { success: false, error: '本番モードのため中止' };
  }
  
  console.log('');
  console.log('📤 予約依頼メールを送信中...');
  console.log('送信先: ' + Config.getGolfClubEmail());
  console.log('');
  
  // 予約依頼メール送信
  const result = GRMMail.sendReservationRequest();
  
  if (result.success) {
    console.log('✅ メール送信成功！');
    console.log('対象月: ' + result.targetMonth);
    console.log('');
    console.log('📧 ' + Config.getGolfClubEmail() + ' のメールボックスを確認してください');
    console.log('');
    console.log('✅ テスト02完了 → 次は test03_SimulateReply を実行');
  } else {
    console.log('❌ メール送信失敗: ' + result.error);
  }
  
  console.log('========================================');
  return result;
}

/**
 * ★★★ テスト03: メール解析（複数パターン検索） ★★★
 * 
 * 【説明】複数の方法で予約返信メールを検索し、解析してLINE通知を送信します
 * 【検索優先順位】1.スレッドID追跡 2.件名識別子 3.ラベル 4.本文パターン
 * 【実行場所】GASエディタ → 関数選択「test03_ParseReply」→ ▶実行
 */
function test03_ParseReply() {
  console.log('========================================');
  console.log('  テスト03: メール返信解析（複数パターン検索）');
  console.log('========================================');
  
  console.log('');
  console.log('📧 複数の方法でゴルフ場からの返信メールを検索中...');
  console.log('');
  
  const props = PropertiesService.getScriptProperties();
  
  // 監視状態を確認
  const monitoringActive = props.getProperty('GRM_MONITORING_ACTIVE');
  const savedThreadId = props.getProperty('GRM_THREAD_ID');
  const savedIdentifier = props.getProperty('GRM_IDENTIFIER');
  const savedTargetYear = props.getProperty('GRM_TARGET_YEAR');
  const savedTargetMonth = props.getProperty('GRM_TARGET_MONTH');
  const processedEmailIds = JSON.parse(props.getProperty('GRM_PROCESSED_EMAIL_IDS') || '[]');
  
  console.log('【監視状態】');
  console.log('・監視フラグ: ' + (monitoringActive === 'true' ? '✅ アクティブ' : '❌ 非アクティブ'));
  console.log('・スレッドID: ' + (savedThreadId ? savedThreadId.substring(0, 20) + '...' : '未設定'));
  console.log('・識別子: ' + (savedIdentifier || '未設定'));
  console.log('');
  
  let emailBody = '';
  let emailSubject = '';
  let emailDate = '';
  let emailFrom = '';
  let emailId = '';
  let detectionMethod = '';
  let foundEmail = false;
  
  // ========================================
  // 優先順位1: スレッドID追跡
  // ========================================
  if (savedThreadId && !foundEmail) {
    console.log('🔍 方法1: スレッドID追跡で検索...');
    try {
      const thread = GmailApp.getThreadById(savedThreadId);
      if (thread) {
        const messages = thread.getMessages();
        console.log('   スレッド内メッセージ数: ' + messages.length);
        
        if (messages.length > 1) {
          // 最初のメッセージ（送信メール）のIDを取得してスキップ対象にする
          const firstMessageId = messages[0].getId();
          
          // 最新の返信（最初のメッセージ以外）
          for (let i = messages.length - 1; i >= 1; i--) {
            const msg = messages[i];
            emailId = msg.getId();
            
            console.log(`   メッセージ${i}: ${msg.getFrom().substring(0, 30)}...`);
            
            // 既に処理済みかチェック
            if (!processedEmailIds.includes(emailId)) {
              emailSubject = msg.getSubject();
              emailDate = msg.getDate().toLocaleString('ja-JP');
              emailFrom = msg.getFrom();
              emailBody = msg.getPlainBody();
              detectionMethod = 'スレッドID追跡';
              foundEmail = true;
              console.log('   ✅ スレッドから返信を発見');
              break;
            } else {
              console.log('   → 処理済みのためスキップ');
            }
          }
        }
      } else {
        console.log('   ⚠️ スレッドが見つかりません');
      }
    } catch (e) {
      console.log('   ⚠️ スレッドID検索エラー: ' + e.message);
    }
    if (!foundEmail) console.log('   → 該当なし');
  }
  
  // ========================================
  // 優先順位2: 件名識別子
  // ========================================
  if (savedIdentifier && !foundEmail) {
    console.log('🔍 方法2: 件名識別子で検索...');
    try {
      const threads = GmailApp.search(`subject:"${savedIdentifier}" -from:me`, 0, 5);
      for (const thread of threads) {
        const messages = thread.getMessages();
        const msg = messages[messages.length - 1];
        emailId = msg.getId();
        if (!processedEmailIds.includes(emailId)) {
          emailSubject = msg.getSubject();
          emailDate = msg.getDate().toLocaleString('ja-JP');
          emailFrom = msg.getFrom();
          emailBody = msg.getPlainBody();
          detectionMethod = '件名識別子';
          foundEmail = true;
          console.log('   ✅ 識別子付きメールを発見');
          break;
        }
      }
    } catch (e) {
      console.log('   ⚠️ 識別子検索エラー: ' + e.message);
    }
    if (!foundEmail) console.log('   → 該当なし');
  }
  
  // ========================================
  // 優先順位3: ラベル
  // ========================================
  if (!foundEmail) {
    console.log('🔍 方法3: ラベルで検索...');
    try {
      const label = GmailApp.getUserLabelByName('GRM/予約依頼中');
      if (label) {
        const threads = label.getThreads();
        for (const thread of threads) {
          const messages = thread.getMessages();
          // 返信があるスレッド（2件以上）
          if (messages.length > 1) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (!msg.getFrom().includes('midorikawa')) {
                emailId = msg.getId();
                if (!processedEmailIds.includes(emailId)) {
                  emailSubject = msg.getSubject();
                  emailDate = msg.getDate().toLocaleString('ja-JP');
                  emailFrom = msg.getFrom();
                  emailBody = msg.getPlainBody();
                  detectionMethod = 'ラベル検索';
                  foundEmail = true;
                  console.log('   ✅ ラベル付きスレッドから返信を発見');
                  break;
                }
              }
            }
          }
          if (foundEmail) break;
        }
      }
    } catch (e) {
      console.log('   ⚠️ ラベル検索エラー: ' + e.message);
    }
    if (!foundEmail) console.log('   → 該当なし');
  }
  
  // ========================================
  // 優先順位4: 本文パターン（フォールバック）
  // ========================================
  if (!foundEmail) {
    console.log('🔍 方法4: 本文パターンで検索（フォールバック）...');
    try {
      const searchQuery = 'newer_than:14d from:tokyu-rs OR from:asakura';
      const threads = GmailApp.search(searchQuery, 0, 10);
      
      for (const thread of threads) {
        const messages = thread.getMessages();
        const msg = messages[messages.length - 1];
        const body = msg.getPlainBody();
        
        // 3行以上の予約パターンがあるか確認
        const reservationPattern = /(\d{1,2})月(\d{1,2})日.*?(OUT|IN|アウト|イン).*?(\d{1,2})時(\d{2})分/g;
        const matches = body.match(reservationPattern);
        
        if (matches && matches.length >= 3) {
          emailId = msg.getId();
          if (!processedEmailIds.includes(emailId)) {
            emailSubject = msg.getSubject();
            emailDate = msg.getDate().toLocaleString('ja-JP');
            emailFrom = msg.getFrom();
            emailBody = body;
            detectionMethod = '本文パターン検出';
            foundEmail = true;
            console.log('   ✅ 予約リスト形式のメールを発見（' + matches.length + '件の予約検出）');
            break;
          }
        }
      }
    } catch (e) {
      console.log('   ⚠️ 本文パターン検索エラー: ' + e.message);
    }
    if (!foundEmail) console.log('   → 該当なし');
  }
  
  // メールが見つからなかった場合
  if (!foundEmail) {
    console.log('');
    console.log('❌ 予約返信メールが見つかりませんでした');
    console.log('');
    console.log('【対処法】');
    console.log('1. test02_SendRequestMail で予約依頼メールを送信してから返信を待つ');
    console.log('2. test03_ParseReplySample でサンプルデータを使ってテスト');
    console.log('========================================');
    return { success: false, error: 'メールが見つかりません' };
  }
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【検出されたメール】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('・検出方法: ' + detectionMethod);
  console.log('・件名: ' + emailSubject);
  console.log('・差出人: ' + emailFrom);
  console.log('・受信日時: ' + emailDate);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('【メール本文プレビュー】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(emailBody.substring(0, 400) + '...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  // 年月を決定
  let targetYear = parseInt(savedTargetYear) || new Date().getFullYear();
  let targetMonth = parseInt(savedTargetMonth) || (new Date().getMonth() + 2);
  if (targetMonth > 12) {
    targetMonth -= 12;
    targetYear++;
  }
  
  // メール本文から年月を抽出試行
  const yearMonthMatch = emailBody.match(/(\d{4})年(\d{1,2})月/);
  if (yearMonthMatch) {
    targetYear = parseInt(yearMonthMatch[1]);
    targetMonth = parseInt(yearMonthMatch[2]);
  }
  
  console.log('📅 解析対象: ' + targetYear + '年' + targetMonth + '月');
  console.log('');
  
  // メールから予約情報を解析
  const reservations = parseEmailReply(emailBody, targetYear, targetMonth);
  
  if (reservations.length === 0) {
    console.log('❌ 予約情報を解析できませんでした');
    console.log('');
    console.log('メール本文の形式を確認してください');
    return { success: false, error: '予約情報の解析に失敗' };
  }
  
  console.log('✅ ' + reservations.length + '件の予約を検出しました');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【解析結果一覧】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  reservations.forEach((res, index) => {
    console.log(`${index + 1}. ${res.date}（${res.weekday}）${res.course}コース ${res.time}`);
  });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  // LINE通知を送信（クイックリプライボタン付き）
  console.log('📱 LINE通知を送信中...');
  
  const notificationText = 
    `【予約候補検出】\n\n` +
    `【${targetYear}年${targetMonth}月の予約】\n` +
    `${reservations.length}件の予約が見つかりました\n\n` +
    reservations.slice(0, 5).map((res, i) => 
      `${i + 1}. ${res.date}（${res.weekday}）${res.time}`
    ).join('\n') +
    (reservations.length > 5 ? `\n...他${reservations.length - 5}件` : '') +
    `\n\n下のボタンまたは「登録」と返信してください`;
  
  if (isLineEnabled()) {
    try {
      const messages = [{
        type: 'text',
        text: notificationText,
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: '✅ 登録する', text: '登録' } },
            { type: 'action', action: { type: 'message', label: '❌ キャンセル', text: 'キャンセル' } },
            { type: 'action', action: { type: 'message', label: '📊 ステータス', text: 'ステータス' } }
          ]
        }
      }];
      LINE.notifyAdmin(messages);
      console.log('✅ LINE通知送信完了');
    } catch (e) {
      console.log('⚠️ LINE通知エラー: ' + e.message);
    }
  } else {
    console.log('🔕 LINE通知スキップ（Webのみモード）');
  }
  
  // 管理者メールにも同文面を送信
  console.log('📧 管理者メール通知を送信中...');
  try {
    const adminEmail = Config.get('ADMIN_EMAIL');
    if (adminEmail) {
      const emailSubject = '【GRM】' + targetYear + '年' + targetMonth + '月 予約候補検出（' + reservations.length + '件）';
      const emailBody = 'GRM 予約管理システムからの通知\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n【予約候補検出】\n\n【' + targetYear + '年' + targetMonth + '月の予約】\n' + reservations.length + '件の予約が見つかりました\n\n' + reservations.map(function(res, i) { return (i + 1) + '. ' + res.date + '（' + res.weekday + '）' + res.course + 'コース ' + res.time; }).join('\n') + '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【操作方法】\n・LINEで「登録」と返信\n・またはGASエディタで test03b を実行';
      GmailApp.sendEmail(adminEmail, emailSubject, emailBody);
      console.log('✅ 管理者メール送信完了');
    }
  } catch (e) {
    console.log('⚠️ 管理者メール送信エラー: ' + e.message);
  }
  
  console.log('');
  console.log('⚠️ この内容でよろしければ、次のステップで登録を実行してください');
  console.log('');
  console.log('✅ テスト03完了 → 次は test03b_RegisterReservations を実行');
  console.log('========================================');
  
  // ScriptPropertiesに一時保存（test03bで使用）
  PropertiesService.getScriptProperties().setProperty(
    'PENDING_RESERVATIONS', 
    JSON.stringify(reservations)
  );
  
  // メール情報も保存
  PropertiesService.getScriptProperties().setProperty(
    'LAST_PARSED_EMAIL', 
    JSON.stringify({ 
      id: emailId,
      subject: emailSubject, 
      from: emailFrom, 
      date: emailDate,
      detectionMethod: detectionMethod
    })
  );
  
  // 処理済みメールIDを記録
  if (emailId) {
    processedEmailIds.push(emailId);
    props.setProperty('GRM_PROCESSED_EMAIL_IDS', JSON.stringify(processedEmailIds));
    console.log('📝 処理済みメールIDを記録: ' + emailId.substring(0, 20) + '...');
  }
  
  return { success: true, count: reservations.length, reservations: reservations, detectionMethod: detectionMethod };
}



/**
 * ★★★ テスト03b: 予約データ登録（ユーザー確認後） ★★★
 * 
 * 【説明】test03で確認した予約データをスプレッドシートに登録します
 * 【実行場所】GASエディタ → 関数選択「test03b_RegisterReservations」→ ▶実行
 */
function test03b_RegisterReservations() {
  console.log('========================================');
  console.log('  テスト03b: 予約データ登録');
  console.log('========================================');
  
  console.log('');
  console.log('📋 解析済みの予約データを取得中...');
  
  // ScriptPropertiesから予約データを取得
  const savedData = PropertiesService.getScriptProperties().getProperty('PENDING_RESERVATIONS');
  
  if (!savedData) {
    console.log('❌ 解析済みの予約データがありません。先にtest03_ParseReplyを実行してください。');
    return { success: false };
  }
  
  const reservations = JSON.parse(savedData);
  console.log('✅ ' + reservations.length + '件の予約データを確認');
  console.log('');
  console.log('💾 スプレッドシートに登録中...');
  
  // スプレッドシートに保存
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Reservation_DB');
  
  if (!sheet) {
    sheet = ss.insertSheet('Reservation_DB');
    sheet.getRange('A1:L1').setValues([[
      'ID', 'メール受信日', '予約日', '曜日', 'コース', '時間', 
      'ステータス', 'カレンダーEventID', '最終更新日時', '信頼度', 'メールID', '備考'
    ]]);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
  }
  
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  
  reservations.forEach((res, index) => {
    const id = 'res-2026-04-' + String(index + 1).padStart(3, '0');
    sheet.appendRow([
      id,                    // ID
      today,                 // メール受信日
      res.date,              // 予約日
      res.weekday,           // 曜日
      res.course,            // コース
      res.time,              // 時間
      'pending',             // ステータス（承認待ち）
      '',                    // カレンダーEventID
      now,                   // 最終更新日時
      '100',                 // 信頼度
      'test-mail-001',       // メールID
      'テスト登録'           // 備考
    ]);
    
    console.log('・登録: ' + res.date + '（' + res.weekday + '）' + res.course + ' ' + res.time);
  });
  
  // 一時データをクリア
  PropertiesService.getScriptProperties().deleteProperty('PENDING_RESERVATIONS');
  
  // 監視完了処理（ラベル変更）
  try {
    const threadId = PropertiesService.getScriptProperties().getProperty('GRM_THREAD_ID');
    if (threadId) {
      const thread = GmailApp.getThreadById(threadId);
      if (thread) {
        // 「予約依頼中」ラベルを削除し、「処理済み」ラベルを付与
        const oldLabel = GmailApp.getUserLabelByName('GRM/予約依頼中');
        if (oldLabel) thread.removeLabel(oldLabel);
        
        let doneLabel = GmailApp.getUserLabelByName('GRM/処理済み');
        if (!doneLabel) doneLabel = GmailApp.createLabel('GRM/処理済み');
        thread.addLabel(doneLabel);
        
        console.log('📧 メールラベルを「処理済み」に変更しました');
      }
    }
    
    // 監視フラグをOFF
    PropertiesService.getScriptProperties().setProperty('GRM_MONITORING_ACTIVE', 'false');
    console.log('🔕 メール監視を停止しました');
    
  } catch (e) {
    console.log('⚠️ 監視完了処理エラー: ' + e.message);
  }
  
  console.log('');
  console.log('📊 スプレッドシートの Reservation_DB シートを確認してください');
  console.log('');
  console.log('✅ テスト03b完了 → 次は test04_RegisterAllToCalendar を実行');
  console.log('========================================');
  
  return { success: true, count: reservations.length };
}

/**
 * メール返信から予約情報を解析するヘルパー関数
 * 様々なメール形式に対応した包括的な正規化・解析
 */
function parseEmailReply(emailBody, year, month) {
  const reservations = [];
  
  // ========================================
  // Step 1: 包括的な正規化
  // ========================================
  let normalized = emailBody
    // 全角数字を半角に
    .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
    .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
    .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
    .replace(/９/g, '9')
    // 全角英字を半角に
    .replace(/ＯＵＴ/g, 'OUT').replace(/ＩＮ/g, 'IN')
    .replace(/Ｏ/g, 'O').replace(/Ｕ/g, 'U').replace(/Ｔ/g, 'T')
    .replace(/Ｉ/g, 'I').replace(/Ｎ/g, 'N')
    // 全角コロンを半角に
    .replace(/：/g, ':')
    // 全角括弧を半角に
    .replace(/（/g, '(').replace(/）/g, ')')
    // 全角スペースを半角に
    .replace(/　/g, ' ')
    // 連続スペースを1つに
    .replace(/  +/g, ' ')
    // タイポ修正: 「４日１９日」→「4月19日」
    .replace(/(\d+)日(\d+)日/g, '$1月$2日');
  
  // 各行を解析
  const lines = normalized.split('\n');
  let lastMonth = month;  // 月省略パターン用
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    // 引用行を除外（> で始まる行）
    if (trimmedLine.startsWith('>')) {
      continue;
    }
    
    // 除外パターン（祝日、休場日、メモなど）
    if (trimmedLine.includes('祝日') || 
        trimmedLine.includes('休場') || 
        trimmedLine.includes('メモ') ||
        trimmedLine.includes('ご確認') ||
        trimmedLine.includes('よろしく') ||
        trimmedLine.includes('お待ち') ||
        trimmedLine.includes('お世話') ||
        trimmedLine.includes('ございます') ||
        trimmedLine.includes('担当') ||
        trimmedLine.includes('様') ||
        trimmedLine.includes('希望日程') ||
        trimmedLine.includes('希望時間') ||
        trimmedLine.includes('■') ||
        trimmedLine.includes('━') ||
        trimmedLine.includes('※')) {
      continue;
    }
    
    let matched = false;
    let dayNum, weekday, course, hour, minute;
    
    // ========================================
    // Pattern 1: 標準形式
    // 4月1日(水) OUTコース 7時30分
    // 4月1日(水) OUTコース 7:30スタート
    // ========================================
    let match = trimmedLine.match(/(\d{1,2})月\s*(\d{1,2})日\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s*コース?\s*(\d{1,2})[時:](\d{2})(?:分|スタート)?/i);
    if (match) {
      lastMonth = parseInt(match[1]);
      dayNum = parseInt(match[2]);
      weekday = match[3];
      course = match[4].toUpperCase();
      hour = parseInt(match[5]);
      minute = parseInt(match[6]);
      matched = true;
    }
    
    // ========================================
    // Pattern 2: 月省略形式（日から始まる）
    // 2日(木) INコース 7:30
    // ========================================
    if (!matched) {
      match = trimmedLine.match(/^(\d{1,2})日\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s*コース?\s*(\d{1,2})[時:](\d{2})(?:分|スタート)?/i);
      if (match) {
        dayNum = parseInt(match[1]);
        weekday = match[2];
        course = match[3].toUpperCase();
        hour = parseInt(match[4]);
        minute = parseInt(match[5]);
        matched = true;
      }
    }
    
    // ========================================
    // Pattern 3: 短縮形式
    // 12/3(水)IN7:30
    // 12/3(水) OUT 7:30
    // ========================================
    if (!matched) {
      match = trimmedLine.match(/(\d{1,2})\/(\d{1,2})\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s*(\d{1,2}):(\d{2})/i);
      if (match) {
        lastMonth = parseInt(match[1]);
        dayNum = parseInt(match[2]);
        weekday = match[3];
        course = match[4].toUpperCase();
        hour = parseInt(match[5]);
        minute = parseInt(match[6]);
        matched = true;
      }
    }
    
    // ========================================
    // Pattern 4: 日付のみ省略形式（月が前行から継承）
    // 6(木) OUT 7:38
    // 6(木)OUT 7:38
    // ========================================
    if (!matched) {
      match = trimmedLine.match(/^(\d{1,2})\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s*(\d{1,2}):(\d{2})/i);
      if (match) {
        dayNum = parseInt(match[1]);
        weekday = match[2];
        course = match[3].toUpperCase();
        hour = parseInt(match[4]);
        minute = parseInt(match[5]);
        matched = true;
      }
    }
    
    // ========================================
    // Pattern 5: スペース多め形式
    // 11/5(水)IN  7:30
    // ========================================
    if (!matched) {
      match = trimmedLine.match(/(\d{1,2})\/(\d{1,2})\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s+(\d{1,2}):(\d{2})/i);
      if (match) {
        lastMonth = parseInt(match[1]);
        dayNum = parseInt(match[2]);
        weekday = match[3];
        course = match[4].toUpperCase();
        hour = parseInt(match[5]);
        minute = parseInt(match[6]);
        matched = true;
      }
    }
    
    // ========================================
    // Pattern 6: コロンなし時間形式
    // 4月1日(水) OUTコース 7時30分
    // ========================================
    if (!matched) {
      match = trimmedLine.match(/(\d{1,2})月\s*(\d{1,2})日\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s*コース?\s*(\d{1,2})時(\d{2})分/i);
      if (match) {
        lastMonth = parseInt(match[1]);
        dayNum = parseInt(match[2]);
        weekday = match[3];
        course = match[4].toUpperCase();
        hour = parseInt(match[5]);
        minute = parseInt(match[6]);
        matched = true;
      }
    }
    
    // ========================================
    // Pattern 7: 年月日なしで日付と曜日が先頭
    // 10月1日(水) OUTコース 7:30
    // ========================================
    if (!matched) {
      match = trimmedLine.match(/(\d{1,2})月(\d{1,2})日\s*\(?([月火水木金土日])\)?\s*(OUT|IN)\s*コース?\s*(\d{1,2}):(\d{2})/i);
      if (match) {
        lastMonth = parseInt(match[1]);
        dayNum = parseInt(match[2]);
        weekday = match[3];
        course = match[4].toUpperCase();
        hour = parseInt(match[5]);
        minute = parseInt(match[6]);
        matched = true;
      }
    }
    
    // マッチした場合、予約を追加
    if (matched && dayNum && weekday && course && hour !== undefined && minute !== undefined) {
      // 月が明示されていない場合はlastMonthを使用
      const useMonth = lastMonth || month;
      
      // 1月・2月の予約で年を跨ぐ場合の処理
      let useYear = year;
      if (useMonth < month && month >= 10) {
        useYear = year + 1;
      }
      
      reservations.push({
        date: `${useYear}-${String(useMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
        weekday: weekday,
        course: course,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      });
    }
  }
  
  // デバッグ用ログ
  if (reservations.length === 0) {
    console.log('⚠️ 予約が検出されませんでした。メール本文の形式を確認してください。');
  }
  
  return reservations;
}

/**
 * ★★★ テスト04: 全件一括カレンダー登録 ★★★
 * 
 * 【説明】すべての承認待ち予約をGoogleカレンダーに一括登録します
 * 【実行場所】GASエディタ → 関数選択「test04_RegisterAllToCalendar」→ ▶実行
 */
function test04_RegisterAllToCalendar() {
  console.log('========================================');
  console.log('  テスト04: 全件一括カレンダー登録');
  console.log('========================================');
  
  console.log('');
  console.log('📋 承認待ちの予約を検索中...');
  
  // 承認待ちの予約を取得
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  
  if (!sheet) {
    console.log('❌ 予約シートがありません。test03b_RegisterReservationsを先に実行してください。');
    return { success: false };
  }
  
  const data = sheet.getDataRange().getValues();
  const pendingReservations = [];
  
  // カラム構造：ID(0), メール受信日(1), 予約日(2), 曜日(3), コース(4), 時間(5), ステータス(6), EventID(7)...
  for (let i = 1; i < data.length; i++) {
    if (data[i][6] === 'pending') {
      pendingReservations.push({
        row: i + 1,
        id: data[i][0],
        date: data[i][2],
        weekday: data[i][3],
        course: data[i][4],
        time: data[i][5]
      });
    }
  }
  
  if (pendingReservations.length === 0) {
    console.log('❌ 承認待ちの予約がありません。test03b_RegisterReservationsを先に実行してください。');
    return { success: false };
  }
  
  console.log('✅ ' + pendingReservations.length + '件の承認待ち予約を発見');
  console.log('');
  console.log('📅 Googleカレンダーに一括登録中...');
  console.log('');
  
  // カレンダーに登録
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  if (!calendar) {
    console.log('❌ カレンダーが見つかりません: ' + calendarId);
    return { success: false };
  }
  
  let successCount = 0;
  const eventIds = [];
  
  pendingReservations.forEach((res, index) => {
    try {
      const eventDate = new Date(res.date);
      
      // 時間の処理（スプレッドシートからDate型で取得される場合に対応）
      let hours, minutes;
      const timeValue = res.time;
      if (timeValue instanceof Date) {
        hours = timeValue.getHours();
        minutes = timeValue.getMinutes();
      } else if (typeof timeValue === 'string') {
        [hours, minutes] = timeValue.split(':').map(Number);
      } else {
        hours = 7;
        minutes = 30;
      }
      eventDate.setHours(hours, minutes, 0, 0);
      
      const timeString = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
      
      const endDate = new Date(eventDate);
      endDate.setHours(endDate.getHours() + 6);
      
      // カレンダーイベント作成（新形式）
      const event = calendar.createEvent(
        '【外出】ゴルフ 麻倉 ' + timeString + ' 残数3',
        eventDate,
        endDate,
        {
          description: '[System:GolfMgr] テスト予約\nコース: ' + res.course + '\nスタート時間: ' + timeString + '\nID: ' + res.id,
          location: '麻倉ゴルフ倶楽部'
        }
      );
      
      const eventId = event.getId();
      eventIds.push(eventId);
      
      // ステータスとEventIDを更新
      sheet.getRange(res.row, 7).setValue('confirmed');  // ステータス
      sheet.getRange(res.row, 8).setValue(eventId);       // EventID
      
      successCount++;
      console.log(`${index + 1}. ✅ ${res.date}（${res.weekday}）${res.course} ${timeString} → 登録完了`);
      
    } catch (error) {
      console.log(`${index + 1}. ❌ ${res.date} エラー: ${error.message}`);
    }
  });
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 結果: ${successCount}/${pendingReservations.length}件 登録成功`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📅 Googleカレンダー（' + calendarId + '）を確認してください');
  console.log('');
  console.log('✅ テスト04完了 → 次は test05_SendLineNotification を実行');
  console.log('========================================');
  
  return { success: true, count: successCount, eventIds: eventIds };
}

/**
 * ★★★ テスト05: LINE通知送信 ★★★
 * 
 * 【説明】カレンダー登録完了のLINE通知を送信します
 * 【実行場所】GASエディタ → 関数選択「test05_SendLineNotification」→ ▶実行
 */
function test05_SendLineNotification() {
  console.log('========================================');
  console.log('  テスト05: LINE通知送信');
  console.log('========================================');
  
  console.log('');
  console.log('� 登録済み予約を確認中...');
  
  // スプレッドシートから確定済み予約を取得
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  
  let confirmedCount = 0;
  const reservationDetails = [];
  
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][6] === 'confirmed' && String(data[i][0]).startsWith('res-2026-04-')) {
        confirmedCount++;
        // 全件を表示（目視チェック用）
        const dateValue = data[i][2];
        let dateStr;
        if (dateValue instanceof Date) {
          dateStr = `${dateValue.getMonth() + 1}/${dateValue.getDate()}`;
        } else {
          dateStr = String(dateValue).split('-').slice(1).join('/');
        }
        
        // 時間も表示
        const timeValue = data[i][5];
        let timeStr;
        if (timeValue instanceof Date) {
          timeStr = `${String(timeValue.getHours()).padStart(2, '0')}:${String(timeValue.getMinutes()).padStart(2, '0')}`;
        } else {
          timeStr = String(timeValue);
        }
        
        reservationDetails.push(`・${dateStr}（${data[i][3]}）${data[i][4]} ${timeStr}`);
      }
    }
  }
  
  console.log('✅ ' + confirmedCount + '件の予約が確定済み');
  console.log('');
  console.log('📱 LINE通知を送信中...');
  
  // LINE通知メッセージを作成（全件表示）
  let message = '🏌️ GRM カレンダー登録完了通知\n\n';
  message += `2026年4月の予約 ${confirmedCount}件 がGoogleカレンダーに登録されました！\n\n`;
  
  if (reservationDetails.length > 0) {
    message += '【登録された予約一覧】\n';
    message += reservationDetails.join('\n');
    message += '\n\n';
  }
  
  message += '📅 カレンダーをご確認ください';
  
  const result = LINE.sendTextMessage(message);
  
  if (result.success) {
    console.log('✅ LINE通知送信成功！');
    console.log('');
    console.log('📱 LINEアプリを確認してください');
  } else {
    console.log('❌ LINE通知送信失敗: ' + result.error);
  }
  
  console.log('');
  console.log('✅ テスト05完了 → 次は test06_CleanupAll を実行（テストデータ削除）');
  console.log('========================================');
  
  return result;
}

/**
 * ★★★ テスト06: テストデータ一括削除 ★★★
 * 
 * 【説明】テストで作成した予約データとカレンダーイベントを一括削除します
 * 【実行場所】GASエディタ → 関数選択「test06_CleanupAll」→ ▶実行
 */
function test06_CleanupAll() {
  console.log('========================================');
  console.log('  テスト06: テストデータ一括削除');
  console.log('========================================');
  
  console.log('');
  console.log('🗑️ テストデータを削除中...');
  console.log('');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  let sheetDeleteCount = 0;
  let calendarDeleteCount = 0;
  
  // スプレッドシートからテストデータを削除（EventIDでカレンダーからも削除）
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    
    // 下から削除（行番号がずれないように）
    for (let i = data.length - 1; i >= 1; i--) {
      const id = String(data[i][0]);
      
      // テスト予約対象（res-2026-04, res-2026-05, または test）
      if (id.startsWith('res-2026-') || id.startsWith('test')) {
        const eventId = data[i][7];  // EventID列
        
        // カレンダーイベントを削除
        if (eventId && calendar) {
          try {
            const event = calendar.getEventById(eventId);
            if (event) {
              event.deleteEvent();
              calendarDeleteCount++;
              console.log(`🗑️ カレンダー削除: ${data[i][2]}（${data[i][3]}）${data[i][4]}`);
            }
          } catch (e) {
            console.log(`⚠️ カレンダー削除スキップ: ${id}`);
          }
        }
        
        // スプレッドシート行を削除
        sheet.deleteRow(i + 1);
        sheetDeleteCount++;
        console.log(`🗑️ スプレッドシート削除: ${id}`);
      }
    }
  }
  
  // カレンダーの説明文でこのシステムで生成したイベントのみを検索して削除
  // 安全条件: 説明文に「[System:GolfMgr] ID:」が含まれるイベントのみ削除
  if (calendar) {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-12-31');
    const events = calendar.getEvents(startDate, endDate);
    
    events.forEach(event => {
      const desc = event.getDescription() || '';
      // 安全条件: このシステムが生成したイベントのみを削除
      if (desc.includes('[System:GolfMgr] ID:')) {
        event.deleteEvent();
        calendarDeleteCount++;
        console.log(`🗑️ カレンダー削除: ${event.getTitle()}`);
      }
    });
  }
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 削除結果`);
  console.log(`  ・スプレッドシート: ${sheetDeleteCount}件`);
  console.log(`  ・カレンダーイベント: ${calendarDeleteCount}件`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('✅ テストデータの削除が完了しました');
  console.log('');
  console.log('📋 スプレッドシートとGoogleカレンダーを確認してください');
  console.log('========================================');
  
  return { success: true, sheetDeleted: sheetDeleteCount, calendarDeleted: calendarDeleteCount };
}

/**
 * ★★★ テスト一覧表示 ★★★
 * 
 * 【説明】すべてのテスト関数の一覧を表示します
 * 【実行場所】GASエディタ → 関数選択「testHelp」→ ▶実行
 */
function testHelp() {
  console.log('========================================');
  console.log('  GRM テスト手順ガイド');
  console.log('========================================');
  console.log('');
  console.log('【テスト関数一覧】');
  console.log('');
  console.log('test01_CheckConfig          → 設定確認');
  console.log('test02_SendRequestMail      → 予約依頼メール送信');
  console.log('test03_ParseReply           → メール解析（確認のみ）');
  console.log('test03b_RegisterReservations → 予約データ登録');
  console.log('test04_RegisterAllToCalendar → 全件カレンダー登録');
  console.log('test05_SendLineNotification → LINE通知送信');
  console.log('test06_CleanupAll           → テストデータ削除');
  console.log('');
  console.log('【マージテスト】');
  console.log('testMerge01_Setup           → マージテスト用子予定作成');
  console.log('testMerge02_Detect          → マージ候補検出');
  console.log('testMerge03_Execute         → マージ実行');
  console.log('testMerge04_Cleanup         → マージテストデータ削除');
  console.log('');
  console.log('【推奨実行順序】');
  console.log('test01 → test02 → test03 →（確認）→ test03b → test04 → test05');
  console.log('');
  console.log('【テストデータ削除】');
  console.log('test06_CleanupAll でスプレッドシートとカレンダーを一括クリア');
  console.log('');
  console.log('========================================');
}

// ============================================
// マージ機能テスト
// ============================================

/**
 * ★★★ マージテスト01: マージ用子予定を作成 ★★★
 * 
 * 【説明】カレンダーに手動追加風の子予定を作成してマージテストの準備をします
 * 【前提】test04でカレンダーにゴルフ予定が登録済みであること
 * 【実行場所】GASエディタ → 関数選択「testMerge01_Setup」→ ▶実行
 */
function testMerge01_Setup() {
  console.log('========================================');
  console.log('  マージテスト01: 子予定のセットアップ');
  console.log('========================================');
  
  console.log('');
  console.log('📋 カレンダーにテスト用の子予定を作成します...');
  console.log('');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  if (!calendar) {
    console.log('❌ カレンダーが見つかりません: ' + calendarId);
    return { success: false };
  }
  
  // 最初のゴルフ予定を探す（2026年4月の予定）
  const startDate = new Date('2026-04-01');
  const endDate = new Date('2026-04-30');
  const events = calendar.getEvents(startDate, endDate);
  
  let parentEvent = null;
  for (const event of events) {
    const desc = event.getDescription() || '';
    if (desc.includes('[System:GolfMgr]')) {
      parentEvent = event;
      break;
    }
  }
  
  if (!parentEvent) {
    console.log('❌ ゴルフ予定が見つかりません。先にtest04を実行してください。');
    return { success: false };
  }
  
  const parentDate = parentEvent.getStartTime();
  const targetDateStr = `${parentDate.getFullYear()}-${String(parentDate.getMonth() + 1).padStart(2, '0')}-${String(parentDate.getDate()).padStart(2, '0')}`;
  
  console.log('✅ ゴルフ予定を発見: ' + parentEvent.getTitle());
  console.log('   日付: ' + targetDateStr);
  console.log('');
  
  // 子予定を作成（手動追加風）
  const childEvents = [
    {
      title: 'ゴルフ前日準備',
      startOffset: -1,  // 1日前
      startHour: 20,
      endHour: 21,
      description: 'クラブセットの確認\n着替えを用意\n天気予報チェック'
    },
    {
      title: '同伴者との待ち合わせ',
      startOffset: 0,  // 当日
      startHour: 5,
      endHour: 6,
      description: '新宿駅西口集合\n緑川さん、田中さん'
    },
    {
      title: 'ゴルフ後の食事会',
      startOffset: 0,  // 当日
      startHour: 16,
      endHour: 18,
      description: '銀座の焼肉店予約済み\n19番ホール的なやつ'
    }
  ];
  
  const createdEvents = [];
  
  childEvents.forEach((child, index) => {
    const eventDate = new Date(parentDate);
    eventDate.setDate(eventDate.getDate() + child.startOffset);
    eventDate.setHours(child.startHour, 0, 0, 0);
    
    const eventEnd = new Date(eventDate);
    eventEnd.setHours(child.endHour, 0, 0, 0);
    
    // 子予定にはSystem:GolfMgrタグを付けない（手動追加風）
    const event = calendar.createEvent(
      child.title,
      eventDate,
      eventEnd,
      { description: child.description + '\n\n[マージテスト用子予定]' }
    );
    
    createdEvents.push(event.getId());
    console.log(`${index + 1}. ✅ 作成: ${child.title}`);
  });
  
  // 作成したイベントIDを保存（後で削除用）
  PropertiesService.getScriptProperties().setProperty(
    'MERGE_TEST_CHILD_EVENTS',
    JSON.stringify(createdEvents)
  );
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ' + createdEvents.length + '件の子予定を作成しました');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📅 Googleカレンダーを確認してください');
  console.log('');
  console.log('✅ マージテスト01完了 → 次は testMerge02_Detect を実行');
  console.log('========================================');
  
  return { success: true, count: createdEvents.length, targetDate: targetDateStr };
}

/**
 * ★★★ マージテスト02: マージ候補を検出 ★★★
 * 
 * 【説明】ゴルフ予定と同日の子予定（手動追加予定）を検出します
 * 【実行場所】GASエディタ → 関数選択「testMerge02_Detect」→ ▶実行
 */
function testMerge02_Detect() {
  console.log('========================================');
  console.log('  マージテスト02: マージ候補検出');
  console.log('========================================');
  
  console.log('');
  console.log('🔍 マージ候補を検出中...');
  console.log('');
  
  // 全マージ候補を検出
  const candidates = Merger.detectAllMergeCandidates();
  
  if (candidates.length === 0) {
    console.log('❌ マージ候補が見つかりません。');
    console.log('   親予定（システム登録のゴルフ予定）と子予定（手動追加）が同日に必要です。');
    return { success: false };
  }
  
  console.log('✅ ' + candidates.length + '件のマージ候補を発見');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【マージ候補一覧】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  candidates.forEach((candidate, index) => {
    console.log('');
    console.log(`${index + 1}. 日付: ${candidate.date}`);
    console.log(`   親予定: ${candidate.parent.title}`);
    console.log(`   子予定: ${candidate.children.length}件`);
    candidate.children.forEach((child, ci) => {
      console.log(`      ${ci + 1}) ${child.title}`);
    });
  });
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('⚠️ 上記の内容でマージを実行してよろしければ、次のステップへ');
  console.log('');
  console.log('✅ マージテスト02完了 → 次は testMerge03_Execute を実行');
  console.log('========================================');
  
  // 最初の候補をセッションに保存
  PropertiesService.getScriptProperties().setProperty(
    'MERGE_TEST_TARGET_DATE',
    candidates[0].date
  );
  
  return { success: true, candidates: candidates };
}

/**
 * ★★★ マージテスト03: マージを実行 ★★★
 * 
 * 【説明】検出されたマージ候補に対してマージを実行します
 * 【実行場所】GASエディタ → 関数選択「testMerge03_Execute」→ ▶実行
 */
function testMerge03_Execute() {
  console.log('========================================');
  console.log('  マージテスト03: マージ実行');
  console.log('========================================');
  
  console.log('');
  
  // 保存しておいた対象日付を取得
  const targetDate = PropertiesService.getScriptProperties().getProperty('MERGE_TEST_TARGET_DATE');
  
  if (!targetDate) {
    console.log('❌ マージ対象が設定されていません。先にtestMerge02_Detectを実行してください。');
    return { success: false };
  }
  
  console.log('📅 対象日付: ' + targetDate);
  console.log('');
  console.log('🔗 マージを実行中...');
  console.log('');
  
  // マージ実行
  const result = Merger.executeMerge(targetDate);
  
  if (result.success) {
    console.log('✅ マージ成功！');
    console.log('   ' + result.message);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【マージ結果】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('・子予定のメモが親予定の説明文に追加されました');
    console.log('・子予定のタイトルに「<マージ済み>」が付きました');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📅 Googleカレンダーでゴルフ予定の詳細を確認してください');
  } else {
    console.log('❌ マージ失敗: ' + result.message);
  }
  
  console.log('');
  console.log('✅ マージテスト03完了 → テストデータを削除する場合は testMerge04_Cleanup を実行');
  console.log('========================================');
  
  return result;
}

/**
 * ★★★ マージテスト04: マージテストデータを削除 ★★★
 * 
 * 【説明】マージテストで作成した子予定を削除します
 * 【実行場所】GASエディタ → 関数選択「testMerge04_Cleanup」→ ▶実行
 */
function testMerge04_Cleanup() {
  console.log('========================================');
  console.log('  マージテスト04: テストデータ削除');
  console.log('========================================');
  
  console.log('');
  console.log('🗑️ マージテスト用子予定を削除します...');
  console.log('');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  // 保存しておいたイベントIDを取得
  const savedEventIds = PropertiesService.getScriptProperties().getProperty('MERGE_TEST_CHILD_EVENTS');
  
  let deleteCount = 0;
  
  if (savedEventIds) {
    const eventIds = JSON.parse(savedEventIds);
    eventIds.forEach(eventId => {
      try {
        const event = calendar.getEventById(eventId);
        if (event) {
          event.deleteEvent();
          deleteCount++;
          console.log('・削除: ' + eventId.substring(0, 20) + '...');
        }
      } catch (e) {
        console.log('・スキップ（削除済み）: ' + eventId.substring(0, 20) + '...');
      }
    });
    
    PropertiesService.getScriptProperties().deleteProperty('MERGE_TEST_CHILD_EVENTS');
  }
  
  // 「マージテスト用子予定」タグで追加削除
  const startDate = new Date('2026-04-01');
  const endDate = new Date('2026-04-30');
  const events = calendar.getEvents(startDate, endDate);
  
  events.forEach(event => {
    const desc = event.getDescription() || '';
    const title = event.getTitle() || '';
    if (desc.includes('[マージテスト用子予定]') || title.includes('<マージ済み>')) {
      event.deleteEvent();
      deleteCount++;
      console.log('・削除: ' + event.getTitle());
    }
  });
  
  // セッションデータをクリア
  PropertiesService.getScriptProperties().deleteProperty('MERGE_TEST_TARGET_DATE');
  
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ' + deleteCount + '件のテスト用子予定を削除しました');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('✅ マージテスト04完了');
  console.log('========================================');
  
  return { success: true, deleted: deleteCount };
}


// ========================================
// メール自動監視機能
// ========================================

/**
 * メール監視を開始（3分間隔トリガー設定）
 * 返信メール監視モード開始時に呼び出す
 */
function startEmailMonitoring() {
  // 既存のトリガーを削除
  stopEmailMonitoring();
  
  // 3分間隔のトリガーを作成
  ScriptApp.newTrigger('checkEmailReply')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  // 監視状態を保存
  PropertiesService.getScriptProperties().setProperties({
    'GRM_MONITORING_ACTIVE': 'true',
    'GRM_MONITORING_START': new Date().toISOString()
  });
  
  GRMLogger.info('Monitor', 'メール監視開始（3分間隔）');
  console.log('✅ メール監視を開始しました（3分間隔）');
  
  return { success: true, message: 'メール監視を開始しました' };
}

/**
 * メール監視を停止（トリガー削除）
 */
function stopEmailMonitoring() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkEmailReply') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  PropertiesService.getScriptProperties().setProperty('GRM_MONITORING_ACTIVE', 'false');
  GRMLogger.info('Monitor', 'メール監視停止');
  console.log('🔕 メール監視を停止しました');
  
  return { success: true, message: 'メール監視を停止しました' };
}

/**
 * メール返信をチェック（トリガーから呼び出される）
 * 返信が見つかったら自動で解析・通知し、監視を停止
 */
function checkEmailReply() {
  var props = PropertiesService.getScriptProperties();
  var monitoringActive = props.getProperty('GRM_MONITORING_ACTIVE');
  
  if (monitoringActive !== 'true') {
    console.log('⏸️ 監視モードが非アクティブです');
    return;
  }
  
  // 監視期限チェック（14日間）
  var deadline = props.getProperty('GRM_MONITORING_DEADLINE');
  if (deadline && new Date() > new Date(deadline)) {
    console.log('⏰ 監視期限切れ');
    stopEmailMonitoring();
    LINE.sendTextMessage('⏰ メール監視期限（14日間）が切れました。返信がありませんでした。');
    return;
  }
  
  console.log('🔍 メール返信をチェック中...');
  
  var savedThreadId = props.getProperty('GRM_THREAD_ID');
  var savedIdentifier = props.getProperty('GRM_IDENTIFIER');
  var processedEmailIds = JSON.parse(props.getProperty('GRM_PROCESSED_EMAIL_IDS') || '[]');
  
  var emailBody = '';
  var emailId = '';
  var foundEmail = false;
  
  // スレッドID追跡
  if (savedThreadId) {
    try {
      var thread = GmailApp.getThreadById(savedThreadId);
      if (thread) {
        var messages = thread.getMessages();
        if (messages.length > 1) {
          for (var i = messages.length - 1; i >= 1; i--) {
            var msg = messages[i];
            emailId = msg.getId();
            if (processedEmailIds.indexOf(emailId) === -1) {
              emailBody = msg.getPlainBody();
              foundEmail = true;
              console.log('✅ 返信メールを発見');
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log('⚠️ スレッド検索エラー: ' + e.message);
    }
  }
  
  if (!foundEmail) {
    console.log('📭 返信なし');
    return;
  }
  
  // 年月を取得
  var targetYear = parseInt(props.getProperty('GRM_TARGET_YEAR')) || new Date().getFullYear();
  var targetMonth = parseInt(props.getProperty('GRM_TARGET_MONTH')) || (new Date().getMonth() + 2);
  if (targetMonth > 12) { targetMonth -= 12; targetYear++; }
  
  // 予約情報を解析
  var reservations = parseEmailReply(emailBody, targetYear, targetMonth);
  
  if (reservations.length === 0) {
    console.log('⚠️ 予約情報が見つかりませんでした');
    return;
  }
  
  console.log('✅ ' + reservations.length + '件の予約を検出');
  
  // 処理済みメールIDを記録
  processedEmailIds.push(emailId);
  props.setProperty('GRM_PROCESSED_EMAIL_IDS', JSON.stringify(processedEmailIds));
  
  // 予約データを保存
  props.setProperty('PENDING_RESERVATIONS', JSON.stringify(reservations));
  
  // 監視を停止
  stopEmailMonitoring();
  
  // LINE通知（Webのみモードの場合はスキップ）
  if (isLineEnabled()) {
    var notificationText = 
      '【自動検出】予約候補を検出しました\n\n' +
      '【' + targetYear + '年' + targetMonth + '月の予約】\n' +
      reservations.length + '件の予約が見つかりました\n\n' +
      reservations.slice(0, 5).map(function(res, i) {
        return (i + 1) + '. ' + res.date + '（' + res.weekday + '）' + res.time;
      }).join('\n') +
      (reservations.length > 5 ? '\n...他' + (reservations.length - 5) + '件' : '') +
      '\n\n下のボタンまたは「登録」と返信してください';
    
    var messages = [{
      type: 'text',
      text: notificationText,
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '登録する', text: '登録' } },
          { type: 'action', action: { type: 'message', label: 'キャンセル', text: 'キャンセル' } }
        ]
      }
    }];
    
    LINE.notifyAdmin(messages);
  } else {
    console.log('🔕 LINE通知スキップ（Webのみモード）');
  }
  
  // 管理者メール通知
  var adminEmail = Config.get('ADMIN_EMAIL');
  if (adminEmail) {
    var emailSubject = '【GRM自動検出】' + targetYear + '年' + targetMonth + '月 予約候補（' + reservations.length + '件）';
    var emailBodyText = 'GRM 予約管理システム - 自動検出\n\n' +
      reservations.length + '件の予約が見つかりました\n\n' +
      reservations.map(function(res, i) {
        return (i + 1) + '. ' + res.date + '（' + res.weekday + '）' + res.course + 'コース ' + res.time;
      }).join('\n') +
      '\n\n【操作方法】\nLINEで「登録」と返信してください';
    
    GmailApp.sendEmail(adminEmail, emailSubject, emailBodyText);
  }
  
  GRMLogger.info('Monitor', '自動検出完了', { count: reservations.length });
}

/**
 * 監視状態を確認
 */
function getMonitoringStatus() {
  var props = PropertiesService.getScriptProperties();
  var isActive = props.getProperty('GRM_MONITORING_ACTIVE') === 'true';
  var startTime = props.getProperty('GRM_MONITORING_START');
  var deadline = props.getProperty('GRM_MONITORING_DEADLINE');
  var identifier = props.getProperty('GRM_IDENTIFIER');
  
  console.log('========================================');
  console.log('  メール監視ステータス');
  console.log('========================================');
  console.log('');
  console.log('監視状態: ' + (isActive ? '✅ アクティブ' : '❌ 非アクティブ'));
  console.log('識別子: ' + (identifier || '未設定'));
  console.log('開始日時: ' + (startTime || '未設定'));
  console.log('期限: ' + (deadline || '未設定'));
  console.log('');
  
  // トリガー状態
  var triggers = ScriptApp.getProjectTriggers();
  var hasMonitorTrigger = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkEmailReply') {
      hasMonitorTrigger = true;
      break;
    }
  }
  console.log('トリガー: ' + (hasMonitorTrigger ? '✅ 設定済み' : '❌ 未設定'));
  console.log('========================================');
  
  return {
    isActive: isActive,
    hasMonitorTrigger: hasMonitorTrigger,
    startTime: startTime,
    deadline: deadline,
    identifier: identifier
  };
}

// ========================================
// 設定更新関数
// ========================================

/**
 * WEB_APP_URLを更新
 * デプロイ後に新しいURLを設定するために実行
 */
function updateWebAppUrl() {
  var newUrl = 'https://script.google.com/macros/s/AKfycbwk35HLUGvwIlP_W0AtBH3wbDbYw_YpC7JVtTdRnLWI62r2raz6HdMUNyMxD5uFlQ8/exec';
  
  PropertiesService.getScriptProperties().setProperty('WEB_APP_URL', newUrl);
  
  console.log('========================================');
  console.log('  WEB_APP_URL を更新しました');
  console.log('========================================');
  console.log('');
  console.log('新しいURL: ' + newUrl);
  console.log('');
  console.log('========================================');
  
  return { success: true, url: newUrl };
}

/**
 * 全設定を表示
 */
function showAllSettings() {
  console.log('========================================');
  console.log('  GRM 設定一覧');
  console.log('========================================');
  console.log('');
  
  var props = PropertiesService.getScriptProperties().getProperties();
  for (var key in props) {
    console.log(key + ': ' + props[key]);
  }
  
  console.log('');
  console.log('========================================');
}

// ========================================
// 新しい統合テスト関数（解析→登録→カレンダー→通知）
// ========================================

/**
 * ★★★ test03_ParseAndRegister: 全処理を一括実行 ★★★
 * 
 * 【処理順序】
 * 1. メール解析
 * 2. スプレッドシート登録
 * 3. カレンダー登録
 * 4. LINE＆メール通知
 * 
 * 【実行】GASエディタ → test03_ParseAndRegister → ▶実行
 */
function test03_ParseAndRegister() {
  console.log('========================================');
  console.log('  統合テスト: 解析→登録→カレンダー→通知');
  console.log('========================================');
  console.log('');
  
  // ========================================
  // Step 1: メール解析
  // ========================================
  console.log('📧 Step 1: メール解析中...');
  
  var props = PropertiesService.getScriptProperties();
  var savedThreadId = props.getProperty('GRM_THREAD_ID');
  var savedIdentifier = props.getProperty('GRM_IDENTIFIER');
  
  var emailBody = '';
  var foundEmail = false;
  
  // スレッドIDから返信メールを取得
  if (savedThreadId) {
    try {
      var thread = GmailApp.getThreadById(savedThreadId);
      if (thread) {
        var messages = thread.getMessages();
        if (messages.length > 1) {
          // 最新の返信を取得
          emailBody = messages[messages.length - 1].getPlainBody();
          foundEmail = true;
          console.log('✅ 返信メールを発見（スレッドID追跡）');
        }
      }
    } catch (e) {
      console.log('⚠️ スレッド検索エラー: ' + e.message);
    }
  }
  
  if (!foundEmail) {
    // 識別子で検索
    if (savedIdentifier) {
      try {
        var threads = GmailApp.search('subject:' + savedIdentifier, 0, 1);
        if (threads.length > 0) {
          var messages = threads[0].getMessages();
          if (messages.length > 1) {
            emailBody = messages[messages.length - 1].getPlainBody();
            foundEmail = true;
            console.log('✅ 返信メールを発見（識別子検索）');
          }
        }
      } catch (e) {
        console.log('⚠️ 識別子検索エラー: ' + e.message);
      }
    }
  }
  
  if (!foundEmail) {
    console.log('❌ 返信メールが見つかりません');
    console.log('');
    console.log('【対処法】');
    console.log('1. test02_SendRequestMail を実行してメール送信');
    console.log('2. 返信メールを送信');
    console.log('3. この関数を再実行');
    return { success: false, error: 'No reply email found' };
  }
  
  // 年月を取得
  var match = savedIdentifier ? savedIdentifier.match(/GRM-(\d{4})-(\d{2})/) : null;
  var targetYear = match ? parseInt(match[1]) : new Date().getFullYear();
  var targetMonth = match ? parseInt(match[2]) : (new Date().getMonth() + 2);
  if (targetMonth > 12) { targetMonth -= 12; targetYear++; }
  
  // 解析
  var reservations = parseEmailReply(emailBody, targetYear, targetMonth);
  
  if (reservations.length === 0) {
    console.log('❌ 予約情報が見つかりませんでした');
    return { success: false, error: 'No reservations found' };
  }
  
  console.log('✅ ' + reservations.length + '件の予約を検出');
  console.log('');
  
  // ========================================
  // Step 2: スプレッドシート登録
  // ========================================
  console.log('💾 Step 2: スプレッドシート登録中...');
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Reservation_DB');
  
  if (!sheet) {
    sheet = ss.insertSheet('Reservation_DB');
    sheet.getRange('A1:L1').setValues([['ID', 'メール受信日', '予約日', '曜日', 'コース', '時間', 'ステータス', 'カレンダーEventID', '最終更新日時', '信頼度', 'メールID', '備考']]);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
  }
  
  var today = new Date().toISOString().split('T')[0];
  var now = new Date().toISOString();
  var registeredIds = [];
  
  for (var i = 0; i < reservations.length; i++) {
    var res = reservations[i];
    var dateParts = res.date.split('-');
    var id = 'res-' + dateParts[0] + '-' + dateParts[1] + '-' + String(i + 1).padStart(3, '0');
    registeredIds.push(id);
    sheet.appendRow([id, today, res.date, res.weekday, res.course, res.time, 'pending', '', now, '100', 'test03-auto', '統合テスト登録']);
    console.log('・登録: ' + res.date + '（' + res.weekday + '）' + res.course + ' ' + res.time);
  }
  
  console.log('✅ ' + reservations.length + '件をスプレッドシートに登録');
  console.log('');
  
  // ========================================
  // Step 3: カレンダー登録
  // ========================================
  console.log('📅 Step 3: カレンダー登録中...');
  
  var calendarId = Config.get('CALENDAR_ID');
  var calendar = CalendarApp.getCalendarById(calendarId);
  var calendarRegistered = 0;
  
  if (calendar) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][6] === 'pending' && registeredIds.indexOf(data[i][0]) !== -1) {
        try {
          var dateStr = data[i][2];
          var timeStr = data[i][5];
          
          // timeStrがDateオブジェクトの場合は文字列に変換
          var hour, minute;
          if (timeStr instanceof Date) {
            hour = timeStr.getHours();
            minute = timeStr.getMinutes();
            timeStr = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
          } else {
            var timeParts = String(timeStr).split(':');
            hour = parseInt(timeParts[0]);
            minute = parseInt(timeParts[1]);
          }
          
          var eventDate = new Date(dateStr);
          eventDate.setHours(hour, minute, 0, 0);
          var endDate = new Date(eventDate.getTime() + 5 * 60 * 60 * 1000); // 5時間後
          
          var title = '【外出】ゴルフ 麻倉 ' + timeStr + ' 残数3';
          var event = calendar.createEvent(title, eventDate, endDate, {
            location: '麻倉ゴルフ倶楽部',
            description: '[System:GolfMgr] ID:' + data[i][0]
          });
          
          sheet.getRange(i + 1, 7).setValue('confirmed');
          sheet.getRange(i + 1, 8).setValue(event.getId());
          calendarRegistered++;
          console.log('・カレンダー登録: ' + dateStr + ' ' + timeStr);
        } catch (e) {
          console.log('⚠️ カレンダー登録エラー: ' + e.message);
        }
      }
    }
    console.log('✅ ' + calendarRegistered + '件をGoogleカレンダーに登録');
  } else {
    console.log('⚠️ カレンダーが見つかりません。CALENDAR_IDを確認してください。');
  }
  
  console.log('');
  
  // ========================================
  // Step 4: LINE＆メール通知
  // ========================================
  console.log('📱 Step 4: 通知送信中...');
  
  var notificationText = 
    '【登録完了】' + targetYear + '年' + targetMonth + '月\n\n' +
    'スプレッドシート: ' + reservations.length + '件\n' +
    'カレンダー: ' + calendarRegistered + '件\n\n' +
    reservations.slice(0, 5).map(function(res, i) {
      return (i + 1) + '. ' + res.date + '（' + res.weekday + '）' + res.time;
    }).join('\n') +
    (reservations.length > 5 ? '\n...他' + (reservations.length - 5) + '件' : '');
  
  try {
    if (isLineEnabled()) {
      LINE.sendTextMessage(notificationText);
      console.log('✅ LINE通知送信完了');
    } else {
      console.log('🔕 LINE通知はスキップ（無効設定）');
    }
  } catch (e) {
    console.log('⚠️ LINE通知エラー: ' + e.message);
  }
  
  try {
    var adminEmail = Config.get('ADMIN_EMAIL');
    if (adminEmail) {
      var emailSubject = '【GRM】' + targetYear + '年' + targetMonth + '月 登録完了（' + reservations.length + '件）';
      GmailApp.sendEmail(adminEmail, emailSubject, notificationText);
      console.log('✅ 管理者メール送信完了');
    }
  } catch (e) {
    console.log('⚠️ メール送信エラー: ' + e.message);
  }
  
  // 監視停止
  props.setProperty('GRM_MONITORING_ACTIVE', 'false');
  
  console.log('');
  console.log('========================================');
  console.log('  ✅ 統合テスト完了');
  console.log('========================================');
  console.log('');
  console.log('【確認事項】');
  console.log('1. スプレッドシート: Reservation_DB シートを確認');
  console.log('2. Googleカレンダー: ' + targetYear + '年' + targetMonth + '月を確認');
  console.log('3. WEB UI: https://script.google.com/... をリロード');
  
  return { 
    success: true, 
    spreadsheet: reservations.length, 
    calendar: calendarRegistered 
  };
}

// ========================================
// LINE通知ON/OFF設定
// ========================================

/**
 * LINE通知を有効化
 */
function enableLineNotification() {
  PropertiesService.getScriptProperties().setProperty('LINE_ENABLED', 'true');
  console.log('✅ LINE通知を有効化しました');
}

/**
 * LINE通知を無効化
 */
function disableLineNotification() {
  PropertiesService.getScriptProperties().setProperty('LINE_ENABLED', 'false');
  console.log('🔕 LINE通知を無効化しました');
}

/**
 * LINE通知が有効かどうかをチェック
 */
function isLineEnabled() {
  var enabled = PropertiesService.getScriptProperties().getProperty('LINE_ENABLED');
  return enabled !== 'false'; // デフォルトはtrue
}

/**
 * 予約データの確認用テスト関数
 */
function testGetReservations() {
  console.log('========================================');
  console.log('  予約データ確認');
  console.log('========================================');
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log('アクティブスプレッドシート: ' + ss.getName());
  
  var sheets = ss.getSheets();
  console.log('シート一覧:');
  sheets.forEach(function(sheet) {
    console.log('  - ' + sheet.getName() + ' (' + sheet.getLastRow() + '行)');
  });
  
  var dbSheet = ss.getSheetByName('Reservation_DB');
  if (dbSheet) {
    console.log('');
    console.log('Reservation_DB シート:');
    console.log('  行数: ' + dbSheet.getLastRow());
    
    if (dbSheet.getLastRow() > 1) {
      var data = dbSheet.getDataRange().getValues();
      console.log('  データサンプル:');
      for (var i = 1; i < Math.min(data.length, 5); i++) {
        console.log('    ' + i + ': ' + data[i][0] + ' | ' + data[i][2] + ' | ' + data[i][6]);
      }
    }
  } else {
    console.log('❌ Reservation_DB シートが見つかりません');
  }
  
  console.log('');
  console.log('BrainManager.getReservations() 結果:');
  var reservations = BrainManager.getReservations();
  console.log('  件数: ' + reservations.length);
  
  console.log('========================================');
}

/**
 * ★★★ 全トリガーを強制削除 ★★★
 * GASエディタで実行
 */
function deleteAllTriggers() {
  console.log('========================================');
  console.log('  全トリガー強制削除');
  console.log('========================================');
  
  var triggers = ScriptApp.getProjectTriggers();
  console.log('削除前のトリガー数: ' + triggers.length);
  
  triggers.forEach(function(trigger) {
    console.log('削除: ' + trigger.getHandlerFunction());
    ScriptApp.deleteTrigger(trigger);
  });
  
  // 監視状態もリセット
  var props = PropertiesService.getScriptProperties();
  props.setProperty('GRM_MONITORING_ACTIVE', 'false');
  
  console.log('');
  console.log('✅ 全トリガー削除完了');
  console.log('✅ 監視状態をリセット');
  console.log('========================================');
}

/**
 * ★★★ 古いURLを新しいURLに更新 ★★★
 * GASエディタで実行
 */
function fixOldWebAppUrl() {
  var props = PropertiesService.getScriptProperties();
  var newUrl = 'https://script.google.com/macros/s/AKfycbwk35HLUGvwIlP_W0AtBH3wbDbYw_YpC7JVtTdRnLWI62r2raz6HdMUNyMxD5uFlQ8/exec';
  
  props.setProperty('WEB_APP_URL', newUrl);
  
  console.log('========================================');
  console.log('  WEB_APP_URL を更新しました');
  console.log('========================================');
  console.log('新しいURL: ' + newUrl);
  console.log('========================================');
}

// ========================================
// WEB UI 承認機能
// ========================================

/**
 * 個別の予約をカレンダーに登録
 */
function approveReservationToCalendar(reservationId) {
  console.log('========================================');
  console.log('承認処理開始: ' + reservationId);
  console.log('========================================');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  if (!calendar) {
    console.log('❌ カレンダーが見つかりません: ' + calendarId);
    return { success: false, error: 'カレンダーが見つかりません' };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  const data = sheet.getDataRange().getValues();
  
  console.log('検索対象ID: ' + reservationId);
  console.log('データ行数: ' + data.length);
  
  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][0]);
    const rowStatus = data[i][6];
    
    console.log('行' + i + ': ID=' + rowId + ', Status=' + rowStatus);
    
    if (rowId === reservationId && rowStatus === 'pending') {
      try {
        // 日付の取得と変換
        let dateValue = data[i][2];
        let timeValue = data[i][5];
        
        console.log('日付生値: ' + dateValue + ' (型: ' + typeof dateValue + ')');
        console.log('時間生値: ' + timeValue + ' (型: ' + typeof timeValue + ')');
        
        // 日付の処理
        let eventDate;
        if (dateValue instanceof Date) {
          // すでにDateオブジェクトの場合
          eventDate = new Date(dateValue.getTime());
          console.log('日付はDateオブジェクト: ' + eventDate.toISOString());
        } else {
          // 文字列の場合
          const dateStr = String(dateValue);
          // YYYY-MM-DD形式かチェック
          if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parts = dateStr.split('-');
            eventDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          } else {
            eventDate = new Date(dateStr);
          }
          console.log('日付を文字列から変換: ' + eventDate.toISOString());
        }
        
        // 時間の処理
        let hour, minute;
        let timeDisplay;
        if (timeValue instanceof Date) {
          hour = timeValue.getHours();
          minute = timeValue.getMinutes();
          timeDisplay = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
          console.log('時間はDateオブジェクト: ' + timeDisplay);
        } else {
          const timeStr = String(timeValue);
          const timeParts = timeStr.split(':');
          hour = parseInt(timeParts[0]) || 0;
          minute = parseInt(timeParts[1]) || 0;
          timeDisplay = timeStr;
          console.log('時間を文字列から変換: ' + timeDisplay);
        }
        
        // 時刻を設定
        eventDate.setHours(hour, minute, 0, 0);
        const endDate = new Date(eventDate.getTime() + 5 * 60 * 60 * 1000);
        
        console.log('イベント開始: ' + eventDate.toLocaleString('ja-JP'));
        console.log('イベント終了: ' + endDate.toLocaleString('ja-JP'));
        
        // イベント作成
        const title = '【外出】ゴルフ 麻倉 ' + timeDisplay + ' 残数3';
        const event = calendar.createEvent(title, eventDate, endDate, {
          location: '麻倉ゴルフ倶楽部',
          description: '[System:GolfMgr] ID:' + reservationId
        });
        
        const eventId = event.getId();
        
        // ステータス更新
        sheet.getRange(i + 1, 7).setValue('confirmed');
        sheet.getRange(i + 1, 8).setValue(eventId);
        sheet.getRange(i + 1, 9).setValue(new Date());
        
        console.log('✅ 承認完了: ' + reservationId);
        console.log('カレンダーイベントID: ' + eventId);
        console.log('========================================');
        
        return { success: true, id: reservationId, eventId: eventId, date: eventDate.toISOString() };
      } catch (e) {
        console.log('❌ エラー: ' + e.message);
        console.log('スタック: ' + e.stack);
        return { success: false, error: e.message };
      }
    }
  }
  
  console.log('❌ 予約が見つかりません: ' + reservationId);
  return { success: false, error: '予約が見つかりません: ' + reservationId };
}

/**
 * すべての承認待ち予約をカレンダーに登録
 */
function approveAllReservationsToCalendar() {
  console.log('一括承認処理開始');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  if (!calendar) {
    return { success: false, error: 'カレンダーが見つかりません' };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  const data = sheet.getDataRange().getValues();
  
  let count = 0;
  const errors = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][6] === 'pending') {
      try {
        const reservationId = data[i][0];
        const dateStr = data[i][2];
        let timeStr = data[i][5];
        
        let hour, minute;
        if (timeStr instanceof Date) {
          hour = timeStr.getHours();
          minute = timeStr.getMinutes();
          timeStr = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        } else {
          const timeParts = String(timeStr).split(':');
          hour = parseInt(timeParts[0]);
          minute = parseInt(timeParts[1]);
        }
        
        const eventDate = new Date(dateStr);
        eventDate.setHours(hour, minute, 0, 0);
        const endDate = new Date(eventDate.getTime() + 5 * 60 * 60 * 1000);
        
        const title = '【外出】ゴルフ 麻倉 ' + timeStr + ' 残数3';
        const event = calendar.createEvent(title, eventDate, endDate, {
          location: '麻倉ゴルフ倶楽部',
          description: '[System:GolfMgr] ID:' + reservationId
        });
        
        // ステータス更新
        sheet.getRange(i + 1, 7).setValue('confirmed');
        sheet.getRange(i + 1, 8).setValue(event.getId());
        sheet.getRange(i + 1, 9).setValue(new Date());
        
        count++;
        console.log('✅ 承認: ' + reservationId);
      } catch (e) {
        errors.push(e.message);
        console.log('❌ エラー: ' + e.message);
      }
    }
  }
  
  console.log('一括承認完了: ' + count + '件');
  return { success: true, count: count, errors: errors };
}
