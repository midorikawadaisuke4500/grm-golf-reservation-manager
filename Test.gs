/**
 * ========================================
 * GRM テスト関数モジュール v2
 * ========================================
 * 
 * 正しい本番フロー:
 * 1. メール解析 → 2. DB登録 → 3. LINE通知（承認待ち）
 * → [管理者承認] → 4. カレンダー登録 → 5. 完了通知
 * 
 * 【個別テスト】
 * test_Step1_SendMail       → 予約依頼メール送信
 * test_Step2_ParseEmail     → メール解析
 * test_Step3_RegisterDB     → DB登録
 * test_Step4_NotifyLine     → LINE通知（承認待ち）
 * test_Step5_ApproveCalendar → カレンダー登録（承認後）
 * 
 * 【一連動作テスト】
 * test_FullFlow_Manual      → 解析→DB→LINE（承認待ち）
 * test_FullFlow_AutoApprove → 全自動テスト
 * 
 * 【マージテスト】
 * test_Merge_Setup          → マージテスト準備
 * test_Merge_Detect         → マージ検出
 * test_Merge_Execute        → マージ実行
 * test_Merge_Cleanup        → マージ削除
 * 
 * 【ユーティリティ】
 * test_Cleanup              → テストデータ削除
 * test_ShowStatus           → 状態確認
 * test_Help                 → ヘルプ表示
 */

// ========================================
// Step 1: 予約依頼メール送信
// ========================================
function test_Step1_SendMail() {
  console.log('========================================');
  console.log('  Step 1: 予約依頼メール送信');
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
  
  const result = GRMMail.sendReservationRequest();
  
  if (result.success) {
    console.log('✅ メール送信成功！');
    console.log('対象月: ' + result.targetMonth);
    console.log('');
    console.log('📧 ' + Config.getGolfClubEmail() + ' のメールボックスを確認してください');
    console.log('');
    console.log('📋 次のステップ: test_Step2_ParseEmail');
  } else {
    console.log('❌ メール送信失敗: ' + result.error);
  }
  
  console.log('========================================');
  return result;
}

// ========================================
// Step 2: メール解析
// ========================================
function test_Step2_ParseEmail() {
  console.log('========================================');
  console.log('  Step 2: メール解析');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  const threadId = props.getProperty('GRM_THREAD_ID');
  
  if (!threadId) {
    console.log('❌ ThreadIDが見つかりません。先にStep 1を実行してください。');
    return null;
  }
  
  console.log('ThreadID: ' + threadId);
  
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) {
      console.log('❌ スレッドが見つかりません');
      return null;
    }
    
    const messages = thread.getMessages();
    console.log('メッセージ数: ' + messages.length);
    
    if (messages.length < 2) {
      console.log('⚠️ 返信メールがまだありません');
      return null;
    }
    
    const replyMessage = messages[messages.length - 1];
    console.log('返信メール日時: ' + replyMessage.getDate());
    
    const body = replyMessage.getPlainBody();
    console.log('');
    console.log('--- メール本文（先頭300文字）---');
    console.log(body.substring(0, 300));
    console.log('---');
    
    // 解析実行（年月自動推測）
    const reservations = parseEmailReply(body);
    
    console.log('');
    console.log('✅ 解析結果: ' + reservations.length + '件検出');
    reservations.forEach(function(res, i) {
      console.log('  ' + (i+1) + '. ' + res.date + '（' + res.weekday + '）' + res.course + ' ' + res.time);
    });
    
    // 結果を保存
    props.setProperty('PENDING_RESERVATIONS', JSON.stringify(reservations));
    console.log('');
    console.log('📋 次のステップ: test_Step3_RegisterDB');
    
    return reservations;
  } catch (e) {
    console.log('❌ 解析エラー: ' + e.message);
    return null;
  }
}

// ========================================
// Step 3: スプレッドシート登録
// ========================================
function test_Step3_RegisterDB() {
  console.log('========================================');
  console.log('  Step 3: スプレッドシート登録');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  const pendingData = props.getProperty('PENDING_RESERVATIONS');
  
  if (!pendingData) {
    console.log('❌ 保留中の予約データがありません。先にStep 2を実行してください。');
    return null;
  }
  
  const reservations = JSON.parse(pendingData);
  console.log('登録対象: ' + reservations.length + '件');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Reservation_DB');
  
  if (!sheet) {
    sheet = ss.insertSheet('Reservation_DB');
    sheet.getRange('A1:L1').setValues([['ID', 'メール受信日', '予約日', '曜日', 'コース', '時間', 'ステータス', 'カレンダーEventID', '最終更新日時', '信頼度', 'メールID', '備考']]);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
  }
  
  const registeredIds = [];
  const currentYear = new Date().getFullYear();
  
  // 既存IDを取得して重複をチェック
  const existingData = sheet.getDataRange().getValues();
  const existingIds = {};
  for (let j = 1; j < existingData.length; j++) {
    existingIds[String(existingData[j][0])] = true;
  }
  
  reservations.forEach(function(res, i) {
    // 日付バリデーションと補正
    let dateStr = res.date;
    
    if (!dateStr || typeof dateStr !== 'string' || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      console.log('⚠️ 不正な日付形式をスキップ: ' + dateStr);
      return;
    }
    
    const dateParts = dateStr.split('-');
    let year = parseInt(dateParts[0]);
    const month = dateParts[1];
    const day = dateParts[2];
    
    // 2001年などの不正な年を補正
    if (year < currentYear || year > currentYear + 2) {
      const parsedMonth = parseInt(month);
      const currentMonth = new Date().getMonth() + 1;
      if (parsedMonth > currentMonth) {
        year = currentYear;
      } else {
        year = currentYear + 1;
      }
      dateStr = year + '-' + month + '-' + day;
      console.log('✅ 年を補正: ' + res.date + ' → ' + dateStr);
    }
    
    const id = 'res-' + year + '-' + month + '-' + String(i + 1).padStart(3, '0');
    
    // 重複チェック - 既に同じIDが存在する場合はスキップ
    if (existingIds[id]) {
      console.log('⚠️ 重複IDをスキップ: ' + id);
      return;
    }
    
    const now = new Date();
    
    sheet.appendRow([
      id,
      now,
      new Date(dateStr),
      res.weekday,
      res.course,
      res.time,
      'pending',
      '',
      now,
      res.confidence || 1.0
    ]);
    
    registeredIds.push(id);
    console.log('✅ 登録: ' + id + ' - ' + dateStr + '（' + res.weekday + '）' + res.time);
  });
  
  props.setProperty('REGISTERED_IDS', JSON.stringify(registeredIds));
  
  console.log('');
  console.log('✅ ' + registeredIds.length + '件をスプレッドシートに登録');
  console.log('📋 次のステップ: test_Step4_NotifyLine');
  
  return registeredIds;
}

// ========================================
// Step 4: LINE通知（承認待ち）
// ========================================
function test_Step4_NotifyLine() {
  console.log('========================================');
  console.log('  Step 4: LINE通知（承認待ち）');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  const registeredIds = props.getProperty('REGISTERED_IDS');
  
  if (!registeredIds) {
    console.log('❌ 登録済みIDがありません。先にStep 3を実行してください。');
    return null;
  }
  
  const ids = JSON.parse(registeredIds);
  console.log('通知対象: ' + ids.length + '件');
  
  // LINE通知
  if (isLineEnabled()) {
    const message = '📅 新しい予約が登録されました\n\n' +
                    '✅ 登録件数: ' + ids.length + '件\n\n' +
                    '👆 WEB画面またはこのメッセージで承認してください';
    
    const result = LINE.sendTextMessage(message);
    
    if (result.success) {
      console.log('✅ LINE通知送信完了');
    } else {
      console.log('❌ LINE通知エラー: ' + result.error);
    }
  } else {
    console.log('🔕 LINE通知はスキップ（無効設定）');
  }
  
  console.log('');
  console.log('📋 次のステップ: WEB UIまたはLINEで承認 → カレンダー登録');
  console.log('または: test_Step5_ApproveCalendar（自動承認）');
  
  return { success: true, count: ids.length };
}

// ========================================
// Step 5: カレンダー登録（承認後）
// ========================================
function test_Step5_ApproveCalendar() {
  console.log('========================================');
  console.log('  Step 5: カレンダー登録（承認）');
  console.log('========================================');
  
  const result = approveAllReservationsToCalendar();
  
  if (result.success) {
    console.log('✅ ' + result.count + '件をカレンダーに登録');
    
    // 完了通知
    if (isLineEnabled()) {
      LINE.sendTextMessage('✅ ' + result.count + '件の予約をカレンダーに登録しました');
    }
  } else {
    console.log('❌ カレンダー登録エラー: ' + result.error);
  }
  
  console.log('');
  console.log('✅ 全ステップ完了！');
  
  return result;
}

// ========================================
// 一連動作テスト: 手動承認版
// ========================================
function test_FullFlow_Manual() {
  console.log('========================================');
  console.log('  一連動作テスト（手動承認版）');
  console.log('========================================');
  console.log('');
  console.log('このテストは以下を実行します:');
  console.log('  1. メール解析');
  console.log('  2. DB登録');
  console.log('  3. LINE通知（承認待ち）');
  console.log('');
  console.log('カレンダー登録は管理者承認後に行われます。');
  console.log('========================================');
  
  // Step 2: メール解析
  console.log('');
  console.log('【Step 2】メール解析...');
  const reservations = test_Step2_ParseEmail();
  if (!reservations || reservations.length === 0) {
    console.log('❌ 解析失敗または予約なし');
    return { success: false };
  }
  
  // Step 3: DB登録
  console.log('');
  console.log('【Step 3】DB登録...');
  const ids = test_Step3_RegisterDB();
  if (!ids) {
    console.log('❌ DB登録失敗');
    return { success: false };
  }
  
  // Step 4: LINE通知
  console.log('');
  console.log('【Step 4】LINE通知...');
  test_Step4_NotifyLine();
  
  console.log('');
  console.log('========================================');
  console.log('  ✅ 一連動作テスト完了（承認待ち）');
  console.log('========================================');
  console.log('');
  console.log('次のステップ: WEB UIまたはLINEで承認してください');
  
  return { success: true, count: ids.length };
}

// ========================================
// 一連動作テスト: 全自動版
// ========================================
function test_FullFlow_AutoApprove() {
  console.log('========================================');
  console.log('  一連動作テスト（全自動版）');
  console.log('========================================');
  
  // Step 2-4
  const manualResult = test_FullFlow_Manual();
  if (!manualResult.success) {
    return manualResult;
  }
  
  // Step 5: カレンダー登録
  console.log('');
  console.log('【Step 5】カレンダー登録（自動承認）...');
  test_Step5_ApproveCalendar();
  
  console.log('');
  console.log('========================================');
  console.log('  ✅ 全自動テスト完了');
  console.log('========================================');
  
  return { success: true };
}

// ========================================
// テストデータ削除
// ========================================
function test_Cleanup() {
  console.log('========================================');
  console.log('  テストデータ削除');
  console.log('========================================');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  let sheetDeleteCount = 0;
  let calendarDeleteCount = 0;
  const currentYear = new Date().getFullYear();
  
  // スプレッドシートからテストデータを削除
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    
    for (let i = data.length - 1; i >= 1; i--) {
      const id = String(data[i][0]);
      const dateVal = data[i][2];
      
      // 削除対象: res-テスト用, res-undefin-, または不正な日付
      let shouldDelete = id.startsWith('res-' + (currentYear + 1) + '-') || 
                         id.startsWith('res-' + (currentYear + 2) + '-') ||
                         id.startsWith('test') || 
                         id.startsWith('res-undefin');
      
      // 2001年などの不正な日付データも削除
      if (dateVal instanceof Date && (dateVal.getFullYear() < currentYear || dateVal.getFullYear() > currentYear + 3)) {
        shouldDelete = true;
      }
      
      if (shouldDelete) {
        const eventId = data[i][7];
        
        if (eventId && calendar) {
          try {
            const event = calendar.getEventById(eventId);
            if (event) {
              event.deleteEvent();
              calendarDeleteCount++;
            }
          } catch (e) {
            // skip
          }
        }
        
        sheet.deleteRow(i + 1);
        sheetDeleteCount++;
        console.log('🗑️ 削除: ' + id);
      }
    }
  }
  
  // 保存データもクリア
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('PENDING_RESERVATIONS');
  props.deleteProperty('REGISTERED_IDS');
  
  console.log('');
  console.log('✅ 削除完了');
  console.log('  スプレッドシート: ' + sheetDeleteCount + '件');
  console.log('  カレンダー: ' + calendarDeleteCount + '件');
}

// ========================================
// 状態確認
// ========================================
function test_ShowStatus() {
  console.log('========================================');
  console.log('  現在の状態');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  
  console.log('');
  console.log('📧 メール監視:');
  console.log('  ThreadID: ' + (props.getProperty('GRM_THREAD_ID') || 'なし'));
  console.log('  監視状態: ' + (props.getProperty('GRM_MONITORING_ACTIVE') || 'false'));
  
  console.log('');
  console.log('🔔 通知設定:');
  console.log('  LINE: ' + (isLineEnabled() ? '有効' : '無効'));
  console.log('  モード: ' + (PropertiesService.getScriptProperties().getProperty('NOTIFICATION_MODE') || 'hybrid'));
  
  console.log('');
  console.log('📋 保留データ:');
  const pending = props.getProperty('PENDING_RESERVATIONS');
  if (pending) {
    const reservations = JSON.parse(pending);
    console.log('  保留中予約: ' + reservations.length + '件');
  } else {
    console.log('  保留中予約: なし');
  }
  
  console.log('');
  console.log('📅 スプレッドシート:');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  if (sheet) {
    const lastRow = sheet.getLastRow();
    console.log('  Reservation_DB: ' + (lastRow > 1 ? lastRow - 1 : 0) + '件');
  }
  
  console.log('');
  console.log('🔧 トリガー:');
  const triggers = ScriptApp.getProjectTriggers();
  console.log('  登録数: ' + triggers.length);
  triggers.forEach(function(t) {
    console.log('    - ' + t.getHandlerFunction());
  });
  
  console.log('========================================');
}

// ========================================
// ヘルプ
// ========================================
function test_Help() {
  console.log('========================================');
  console.log('  GRM テスト関数一覧 v2');
  console.log('========================================');
  console.log('');
  console.log('【本番フロー】');
  console.log('  1. メール解析 → 2. DB登録 → 3. LINE通知（承認待ち）');
  console.log('  → [管理者承認] → 4. カレンダー登録');
  console.log('');
  console.log('【個別テスト】');
  console.log('  test_Step1_SendMail       - 予約依頼メール送信');
  console.log('  test_Step2_ParseEmail     - メール解析');
  console.log('  test_Step3_RegisterDB     - DB登録');
  console.log('  test_Step4_NotifyLine     - LINE通知（承認待ち）');
  console.log('  test_Step5_ApproveCalendar - カレンダー登録（承認後）');
  console.log('');
  console.log('【一連動作テスト】');
  console.log('  test_FullFlow_Manual      - 解析→DB→LINE（承認待ちで停止）');
  console.log('  test_FullFlow_AutoApprove - 全自動テスト');
  console.log('');
  console.log('【ユーティリティ】');
  console.log('  test_Cleanup              - テストデータ削除');
  console.log('  test_ShowStatus           - 状態確認');
  console.log('  test_Help                 - このヘルプ');
  console.log('');
  console.log('【通知設定】');
  console.log('  enableLineNotification    - LINE通知有効');
  console.log('  disableLineNotification   - LINE通知無効');
  console.log('========================================');
}

// ========================================
// マージテスト（後から追加予定）
// ========================================
function test_Merge_Setup() {
  console.log('マージテスト: 準備（未実装）');
}

function test_Merge_Detect() {
  console.log('マージテスト: 検出（未実装）');
}

function test_Merge_Execute() {
  console.log('マージテスト: 実行（未実装）');
}

function test_Merge_Cleanup() {
  console.log('マージテスト: 削除（未実装）');
}
