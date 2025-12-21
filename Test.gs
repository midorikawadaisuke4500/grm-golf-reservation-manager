/**
 * ========================================
 * GRM テスト関数モジュール
 * ========================================
 * 
 * テスト手順:
 * Step 1: testStep1_SendRequestMail()  → 予約依頼メール送信
 * Step 2: (手動で返信メールを送信)
 * Step 3a: testStep3a_ParseEmail()     → メール解析のみ
 * Step 3b: testStep3b_RegisterToDB()   → スプレッドシート登録のみ
 * Step 3c: testStep3c_RegisterToCalendar() → カレンダー登録のみ
 * Step 3d: testStep3d_SendNotification() → 通知送信のみ
 * Step 4: testStep4_FullProcess()      → 全ステップ一括実行
 * 
 * クリーンアップ:
 * testCleanup() → テストデータ削除
 * 
 * 設定:
 * testShowStatus() → 現在の設定・状態を表示
 */

// ========================================
// Step 1: 予約依頼メール送信
// ========================================
function testStep1_SendRequestMail() {
  console.log('========================================');
  console.log('  Step 1: 予約依頼メール送信');
  console.log('========================================');
  
  try {
    const result = sendReservationRequest();
    console.log('✅ メール送信完了');
    console.log('ThreadID: ' + result.threadId);
    console.log('');
    console.log('📋 次のステップ:');
    console.log('  1. テスト用の返信メールを送信してください');
    console.log('  2. testStep3a_ParseEmail() を実行');
    return result;
  } catch (e) {
    console.log('❌ エラー: ' + e.message);
    return { error: e.message };
  }
}

// ========================================
// Step 3a: メール解析のみ
// ========================================
function testStep3a_ParseEmail() {
  console.log('========================================');
  console.log('  Step 3a: メール解析');
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
    console.log('送信者: ' + replyMessage.getFrom());
    
    const body = replyMessage.getPlainBody();
    console.log('');
    console.log('--- メール本文（先頭500文字）---');
    console.log(body.substring(0, 500));
    console.log('---');
    
    // 解析実行
    const reservations = parseEmailReply(body);
    
    console.log('');
    console.log('✅ 解析結果: ' + reservations.length + '件検出');
    reservations.forEach(function(res, i) {
      console.log('  ' + (i+1) + '. ' + res.date + '（' + res.weekday + '）' + res.course + ' ' + res.time);
    });
    
    // 結果を保存
    props.setProperty('PENDING_RESERVATIONS', JSON.stringify(reservations));
    console.log('');
    console.log('📋 次のステップ: testStep3b_RegisterToDB()');
    
    return reservations;
  } catch (e) {
    console.log('❌ 解析エラー: ' + e.message);
    return null;
  }
}

// ========================================
// Step 3b: スプレッドシート登録のみ
// ========================================
function testStep3b_RegisterToDB() {
  console.log('========================================');
  console.log('  Step 3b: スプレッドシート登録');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  const pendingData = props.getProperty('PENDING_RESERVATIONS');
  
  if (!pendingData) {
    console.log('❌ 保留中の予約データがありません。先にStep 3aを実行してください。');
    return null;
  }
  
  const reservations = JSON.parse(pendingData);
  console.log('登録対象: ' + reservations.length + '件');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  
  if (!sheet) {
    console.log('❌ Reservation_DBシートが見つかりません');
    return null;
  }
  
  const registeredIds = [];
  
  reservations.forEach(function(res, i) {
    const id = 'res-' + res.date.replace(/-/g, '-').substring(0, 7) + '-' + String(i + 1).padStart(3, '0');
    const now = new Date();
    
    sheet.appendRow([
      id,
      now,
      new Date(res.date),
      res.weekday,
      res.course,
      res.time,
      'pending',
      '',
      now,
      res.confidence || 1.0
    ]);
    
    registeredIds.push(id);
    console.log('✅ 登録: ' + id + ' - ' + res.date + '（' + res.weekday + '）' + res.time);
  });
  
  // 登録済みIDを保存
  props.setProperty('REGISTERED_IDS', JSON.stringify(registeredIds));
  
  console.log('');
  console.log('✅ ' + registeredIds.length + '件をスプレッドシートに登録');
  console.log('📋 次のステップ: testStep3c_RegisterToCalendar()');
  
  return registeredIds;
}

// ========================================
// Step 3c: カレンダー登録のみ
// ========================================
function testStep3c_RegisterToCalendar() {
  console.log('========================================');
  console.log('  Step 3c: カレンダー登録');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  const registeredIdsData = props.getProperty('REGISTERED_IDS');
  
  if (!registeredIdsData) {
    console.log('❌ 登録済みIDがありません。先にStep 3bを実行してください。');
    return null;
  }
  
  const registeredIds = JSON.parse(registeredIdsData);
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  if (!calendar) {
    console.log('❌ カレンダーが見つかりません: ' + calendarId);
    return null;
  }
  
  console.log('カレンダー: ' + calendar.getName());
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  const data = sheet.getDataRange().getValues();
  
  let calendarCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0]);
    
    if (data[i][6] === 'pending' && registeredIds.indexOf(id) !== -1) {
      try {
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
          description: '[System:GolfMgr] ID:' + id
        });
        
        // EventIDを保存
        sheet.getRange(i + 1, 8).setValue(event.getId());
        sheet.getRange(i + 1, 7).setValue('confirmed');
        
        calendarCount++;
        console.log('✅ カレンダー登録: ' + eventDate.toLocaleDateString() + ' ' + timeStr);
      } catch (e) {
        console.log('⚠️ エラー: ' + e.message);
      }
    }
  }
  
  console.log('');
  console.log('✅ ' + calendarCount + '件をカレンダーに登録');
  console.log('📋 次のステップ: testStep3d_SendNotification()');
  
  return calendarCount;
}

// ========================================
// Step 3d: 通知送信のみ
// ========================================
function testStep3d_SendNotification() {
  console.log('========================================');
  console.log('  Step 3d: 通知送信');
  console.log('========================================');
  
  const props = PropertiesService.getScriptProperties();
  const pendingData = props.getProperty('PENDING_RESERVATIONS');
  
  if (!pendingData) {
    console.log('❌ 予約データがありません');
    return null;
  }
  
  const reservations = JSON.parse(pendingData);
  const now = new Date();
  const targetYear = now.getFullYear() + 1;
  const targetMonth = now.getMonth() + 1;
  
  const notificationText = 
    '📅 ' + targetYear + '年' + targetMonth + '月の予約を登録しました\n\n' +
    '✅ 登録件数: ' + reservations.length + '件\n\n' +
    reservations.slice(0, 5).map(function(res, i) {
      return (i + 1) + '. ' + res.date + '（' + res.weekday + '）' + res.time;
    }).join('\n');
  
  // LINE通知
  if (isLineEnabled()) {
    try {
      LINE.sendTextMessage(notificationText);
      console.log('✅ LINE通知送信完了');
    } catch (e) {
      console.log('⚠️ LINE通知エラー: ' + e.message);
    }
  } else {
    console.log('🔕 LINE通知はスキップ（無効設定）');
  }
  
  // メール通知
  try {
    const adminEmail = Config.get('ADMIN_EMAIL');
    if (adminEmail) {
      MailApp.sendEmail({
        to: adminEmail,
        subject: '【GRM】' + targetYear + '年' + targetMonth + '月 登録完了（' + reservations.length + '件）',
        body: notificationText
      });
      console.log('✅ メール通知送信完了: ' + adminEmail);
    }
  } catch (e) {
    console.log('⚠️ メール通知エラー: ' + e.message);
  }
  
  console.log('');
  console.log('✅ 通知送信完了');
  
  return true;
}

// ========================================
// Step 4: 全ステップ一括実行
// ========================================
function testStep4_FullProcess() {
  console.log('========================================');
  console.log('  Step 4: 全ステップ一括実行');
  console.log('========================================');
  
  // Step 3a
  const reservations = testStep3a_ParseEmail();
  if (!reservations || reservations.length === 0) {
    console.log('❌ 解析失敗または予約なし');
    return;
  }
  
  console.log('');
  
  // Step 3b
  const ids = testStep3b_RegisterToDB();
  if (!ids) {
    console.log('❌ スプレッドシート登録失敗');
    return;
  }
  
  console.log('');
  
  // Step 3c
  testStep3c_RegisterToCalendar();
  
  console.log('');
  
  // Step 3d
  testStep3d_SendNotification();
  
  console.log('');
  console.log('========================================');
  console.log('  ✅ 全ステップ完了');
  console.log('========================================');
}

// ========================================
// クリーンアップ: テストデータ削除
// ========================================
function testCleanup() {
  console.log('========================================');
  console.log('  テストデータ削除');
  console.log('========================================');
  
  const calendarId = Config.get('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  
  let sheetDeleteCount = 0;
  let calendarDeleteCount = 0;
  
  // スプレッドシートからテストデータを削除
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Reservation_DB');
  
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    
    for (let i = data.length - 1; i >= 1; i--) {
      const id = String(data[i][0]);
      
      if (id.startsWith('res-2026-') || id.startsWith('test')) {
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
  
  // カレンダーからこのシステムで生成したイベントを削除
  if (calendar) {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-12-31');
    const events = calendar.getEvents(startDate, endDate);
    
    events.forEach(function(event) {
      const desc = event.getDescription() || '';
      if (desc.includes('[System:GolfMgr] ID:')) {
        event.deleteEvent();
        calendarDeleteCount++;
        console.log('🗑️ カレンダー削除: ' + event.getTitle());
      }
    });
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
function testShowStatus() {
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
    console.log('  Reservation_DB: ' + (sheet.getLastRow() - 1) + '件');
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
function testHelp() {
  console.log('========================================');
  console.log('  GRM テスト関数一覧');
  console.log('========================================');
  console.log('');
  console.log('【ステップ実行】');
  console.log('  testStep1_SendRequestMail()  - 予約依頼メール送信');
  console.log('  testStep3a_ParseEmail()      - メール解析のみ');
  console.log('  testStep3b_RegisterToDB()    - スプレッドシート登録のみ');
  console.log('  testStep3c_RegisterToCalendar() - カレンダー登録のみ');
  console.log('  testStep3d_SendNotification() - 通知送信のみ');
  console.log('  testStep4_FullProcess()      - 全ステップ一括');
  console.log('');
  console.log('【管理】');
  console.log('  testCleanup()                - テストデータ削除');
  console.log('  testShowStatus()             - 現在の状態確認');
  console.log('  deleteAllTriggers()          - 全トリガー削除');
  console.log('');
  console.log('【設定】');
  console.log('  enableLineNotification()     - LINE通知有効');
  console.log('  disableLineNotification()    - LINE通知無効');
  console.log('========================================');
}
