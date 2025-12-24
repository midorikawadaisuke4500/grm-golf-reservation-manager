/**
 * Golf Reservation Manager (GRM) - LINE
 * LINE Messaging API連携モジュール
 * 
 * フェーズ3: LINE通知・インタラクション機能
 */

const LINE = {
  /**
   * プッシュメッセージを送信
   * @param {string} userId - LINE ユーザーID
   * @param {Array} messages - メッセージ配列
   */
  pushMessage(userId, messages) {
    const accessToken = Config.get('LINE_ACCESS_TOKEN');
    if (!accessToken) {
      GRMLogger.error('LINE', 'アクセストークン未設定');
      return { success: false, error: 'LINE_ACCESS_TOKEN not configured' };
    }

    try {
      const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        payload: JSON.stringify({
          to: userId,
          messages: messages
        })
      });

      GRMLogger.info('LINE', 'プッシュメッセージ送信成功', { userId });
      return { success: true };

    } catch (e) {
      GRMLogger.error('LINE', 'プッシュメッセージ送信エラー', { error: e.message });
      return { success: false, error: e.message };
    }
  },

  /**
   * 管理者にプッシュ通知
   */
  notifyAdmin(messages) {
    const adminUserId = Config.get('LINE_USER_ID');
    if (!adminUserId) {
      GRMLogger.warn('LINE', '管理者ユーザーID未設定');
      return { success: false, error: 'LINE_USER_ID not configured' };
    }
    return this.pushMessage(adminUserId, messages);
  },

  // ============================================
  // メッセージテンプレート
  // ============================================

  /**
   * 予約確認通知（Stage 3）
   */
  sendReservationConfirmNotification(reservation) {
    const date = new Date(reservation.date);
    const formattedDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

    const messages = [{
      type: 'flex',
      altText: `【予約確認】${formattedDate}の予約が届きました`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: '🏌️ 予約確認',
            weight: 'bold',
            size: 'lg',
            color: '#2E7D32'
          }]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '新しい予約が解析されました',
              size: 'sm',
              color: '#666666',
              margin: 'md'
            },
            {
              type: 'separator',
              margin: 'lg'
            },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                this._createInfoRow('📅 日付', formattedDate),
                this._createInfoRow('⏰ 時間', `${reservation.time} スタート`),
                this._createInfoRow('🏷️ コース', `${reservation.course}コース`),
                this._createInfoRow('📊 信頼度', `${Math.round(reservation.confidence * 100)}%`)
              ]
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#2E7D32',
              action: {
                type: 'postback',
                label: '✓ 承認',
                data: `action=confirm&id=${reservation.id}`
              }
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: '✏️ 修正',
                data: `action=edit&id=${reservation.id}`
              }
            }
          ]
        }
      }
    }];

    return this.notifyAdmin(messages);
  },

  /**
   * リマインダー通知（Stage 5）
   */
  sendReminderNotification(reservation, weather) {
    const date = new Date(reservation.date);
    const formattedDate = `${date.getMonth() + 1}月${date.getDate()}日（${reservation.weekday}）`;

    const weatherIcon = {
      sunny: '☀️',
      cloudy: '☁️',
      partlyCloudy: '⛅',
      rainy: '🌧️'
    }[weather.condition] || '🌤️';

    const isGoodWeather = Weather.isGoodForGolf(weather);

    const messages = [{
      type: 'flex',
      altText: `【リマインダー】${formattedDate}のゴルフ予約`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: isGoodWeather ? '#E8F5E9' : '#FFF3E0',
          paddingAll: 'lg',
          contents: [{
            type: 'text',
            text: '⏰ 8日前リマインダー',
            weight: 'bold',
            size: 'lg',
            color: isGoodWeather ? '#2E7D32' : '#E65100'
          }]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: formattedDate,
              weight: 'bold',
              size: 'xl',
              margin: 'md'
            },
            {
              type: 'text',
              text: `${reservation.time} スタート｜${reservation.course}コース`,
              size: 'sm',
              color: '#666666',
              margin: 'sm'
            },
            {
              type: 'separator',
              margin: 'lg'
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'lg',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  flex: 1,
                  contents: [
                    {
                      type: 'text',
                      text: weatherIcon,
                      size: '3xl',
                      align: 'center'
                    },
                    {
                      type: 'text',
                      text: weather.description,
                      size: 'sm',
                      align: 'center',
                      margin: 'sm'
                    }
                  ]
                },
                {
                  type: 'box',
                  layout: 'vertical',
                  flex: 2,
                  contents: [
                    this._createInfoRow('気温', `${weather.temp}°C`),
                    this._createInfoRow('降水確率', `${weather.rainChance}%`),
                    this._createInfoRow('風速', `${weather.wind}m/s`)
                  ]
                }
              ]
            },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              backgroundColor: isGoodWeather ? '#E8F5E9' : '#FFEBEE',
              cornerRadius: 'md',
              paddingAll: 'md',
              contents: [{
                type: 'text',
                text: isGoodWeather ? '✅ ゴルフ日和です！' : '⚠️ 天候に注意が必要です',
                size: 'sm',
                color: isGoodWeather ? '#2E7D32' : '#C62828',
                align: 'center'
              }]
            },
            {
              type: 'text',
              text: '※ 明日からキャンセル料が発生します',
              size: 'xs',
              color: '#E65100',
              margin: 'lg',
              align: 'center'
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#2E7D32',
              action: {
                type: 'postback',
                label: '✓ 実施する',
                data: `action=proceed&id=${reservation.id}`
              }
            },
            {
              type: 'button',
              style: 'secondary',
              color: '#C62828',
              action: {
                type: 'postback',
                label: '✕ キャンセル',
                data: `action=cancel&id=${reservation.id}`
              }
            }
          ]
        }
      }
    }];

    return this.notifyAdmin(messages);
  },

  /**
   * マージ通知（Stage 6）
   */
  sendMergeNotification(mergeInfo) {
    const date = new Date(mergeInfo.date);
    const formattedDate = `${date.getMonth() + 1}月${date.getDate()}日`;

    const messages = [{
      type: 'flex',
      altText: `【マージ候補】${formattedDate}に${mergeInfo.children.length}件の子予定`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#E3F2FD',
          paddingAll: 'lg',
          contents: [{
            type: 'text',
            text: '🔗 予定マージ候補',
            weight: 'bold',
            size: 'lg',
            color: '#1565C0'
          }]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `${formattedDate}のゴルフ予定`,
              weight: 'bold',
              size: 'md',
              margin: 'md'
            },
            {
              type: 'text',
              text: `${mergeInfo.children.length}件の手動追加予定を検出`,
              size: 'sm',
              color: '#666666',
              margin: 'sm'
            },
            {
              type: 'separator',
              margin: 'lg'
            },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: mergeInfo.children.slice(0, 3).map(child => ({
                type: 'box',
                layout: 'horizontal',
                margin: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: '📝',
                    flex: 0
                  },
                  {
                    type: 'text',
                    text: child.title,
                    size: 'sm',
                    color: '#666666',
                    flex: 1,
                    margin: 'sm'
                  }
                ]
              }))
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#1565C0',
              action: {
                type: 'postback',
                label: '🔗 マージ実行',
                data: `action=merge&date=${mergeInfo.date}`
              }
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: 'スキップ',
                data: `action=skip_merge&date=${mergeInfo.date}`
              }
            }
          ]
        }
      }
    }];

    return this.notifyAdmin(messages);
  },

  /**
   * シンプルテキストメッセージ
   */
  sendTextMessage(text) {
    return this.notifyAdmin([{
      type: 'text',
      text: text
    }]);
  },

  /**
   * 完了通知
   */
  sendCompletionNotification(title, message) {
    return this.notifyAdmin([{
      type: 'flex',
      altText: title,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '✅ ' + title,
              weight: 'bold',
              size: 'md',
              color: '#2E7D32'
            },
            {
              type: 'text',
              text: message,
              size: 'sm',
              color: '#666666',
              margin: 'md',
              wrap: true
            }
          ]
        }
      }
    }]);
  },

  /**
   * エラー通知
   */
  sendErrorNotification(title, error) {
    return this.notifyAdmin([{
      type: 'flex',
      altText: `エラー: ${title}`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '❌ ' + title,
              weight: 'bold',
              size: 'md',
              color: '#C62828'
            },
            {
              type: 'text',
              text: error,
              size: 'sm',
              color: '#666666',
              margin: 'md',
              wrap: true
            }
          ]
        }
      }
    }]);
  },

  // ============================================
  // ヘルパー関数
  // ============================================

  _createInfoRow(label, value) {
    return {
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        {
          type: 'text',
          text: label,
          size: 'sm',
          color: '#999999',
          flex: 1
        },
        {
          type: 'text',
          text: value,
          size: 'sm',
          color: '#333333',
          flex: 2,
          align: 'end'
        }
      ]
    };
  }
};

// ============================================
// Webhook ハンドラー
// ============================================

/**
 * LINE Webhook エンドポイント
 * イベントを受信して処理
 */
function doPostLineWebhook(e) {
  try {
    const events = JSON.parse(e.postData.contents).events;
    
    events.forEach(event => {
      handleLineEvent(event);
    });
    
    return ContentService.createTextOutput('OK');
    
  } catch (error) {
    GRMLogger.error('LINE', 'Webhookエラー', { error: error.message });
    return ContentService.createTextOutput('ERROR');
  }
}

/**
 * LINEイベントのハンドリング
 */
function handleLineEvent(event) {
  GRMLogger.info('LINE', 'イベント受信', { type: event.type });
  
  switch (event.type) {
    case 'postback':
      handlePostback(event);
      break;
    case 'message':
      handleMessage(event);
      break;
    default:
      GRMLogger.debug('LINE', '未対応イベント', { type: event.type });
  }
}

/**
 * Postback処理（ボタン押下）
 */
function handlePostback(event) {
  const data = new URLSearchParams(event.postback.data);
  const action = data.get('action');
  const id = data.get('id');
  const date = data.get('date');
  
  GRMLogger.info('LINE', 'Postback処理', { action, id, date });
  
  switch (action) {
    case 'confirm':
      // 予約承認
      const confirmResult = BrainManager.confirmReservation(id);
      if (confirmResult.success) {
        LINE.sendCompletionNotification('予約承認完了', 'カレンダーに登録しました');
      } else {
        LINE.sendErrorNotification('予約承認エラー', confirmResult.error);
      }
      break;
      
    case 'cancel':
      // キャンセル確認
      LINE.sendTextMessage('キャンセルを処理しています...');
      const cancelResult = BrainManager.cancelReservation(id);
      if (cancelResult.success) {
        LINE.sendCompletionNotification('キャンセル完了', 'ゴルフ場にキャンセルメールを送信しました');
      } else {
        LINE.sendErrorNotification('キャンセルエラー', cancelResult.error);
      }
      break;
      
    case 'proceed':
      // 実施確定
      LINE.sendCompletionNotification('実施確定', '当日楽しんできてください！🏌️');
      break;
      
    case 'merge':
      // マージ実行
      const mergeResult = Merger.executeMerge(date);
      if (mergeResult.success) {
        LINE.sendCompletionNotification('マージ完了', mergeResult.message);
      } else {
        LINE.sendErrorNotification('マージエラー', mergeResult.message);
      }
      break;
      
    case 'skip_merge':
      LINE.sendTextMessage('マージをスキップしました');
      break;
      
    case 'edit':
      LINE.sendTextMessage('修正機能は現在Web画面をご利用ください\n' + Config.get('WEB_APP_URL'));
      break;
      
    default:
      GRMLogger.warn('LINE', '未知のアクション', { action });
  }
}


/**
 * テキストメッセージ処理（スプレッドシート＋カレンダー一括登録対応）
 */
function handleMessage(event) {
  if (event.message.type !== 'text') return;
  
  var text = event.message.text.trim();
  var textLower = text.toLowerCase();
  
  // 「登録」コマンド - スプレッドシート＋カレンダー一括登録
  if (text === '登録' || textLower === 'register') {
    GRMLogger.info('LINE', '登録コマンド受信');
    var savedData = PropertiesService.getScriptProperties().getProperty('PENDING_RESERVATIONS');
    
    if (!savedData) {
      LINE.sendTextMessage('登録待ちの予約データがありません');
      return;
    }
    
    try {
      var reservations = JSON.parse(savedData);
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Reservation_DB');
      
      if (!sheet) {
        sheet = ss.insertSheet('Reservation_DB');
        sheet.getRange('A1:L1').setValues([['ID', 'メール受信日', '予約日', '曜日', 'コース', '時間', 'ステータス', 'カレンダーEventID', '最終更新日時', '信頼度', 'メールID', '備考']]);
        sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
      }
      
      var today = new Date().toISOString().split('T')[0];
      var now = new Date().toISOString();
      var calendarRegistered = 0;
      
      // 既存IDを取得して重複をチェック
      var existingData = sheet.getDataRange().getValues();
      var existingIds = {};
      for (var j = 1; j < existingData.length; j++) {
        existingIds[String(existingData[j][0])] = true;
      }
      
      for (var i = 0; i < reservations.length; i++) {
        var res = reservations[i];
        
        // 日付バリデーション - YYYY-MM-DD形式であることを確認
        var dateStr = res.date;
        if (!dateStr || typeof dateStr !== 'string' || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          GRMLogger.warn('LINE', '不正な日付形式をスキップ', { date: dateStr });
          continue;
        }
        
        var dateParts = dateStr.split('-');
        var year = parseInt(dateParts[0]);
        var month = dateParts[1];
        
        // 2001年などの不正な年を現在年+1に補正
        var currentYear = new Date().getFullYear();
        if (year < currentYear || year > currentYear + 2) {
          year = currentYear + 1;
          dateStr = year + '-' + dateParts[1] + '-' + dateParts[2];
          res.date = dateStr;
          GRMLogger.warn('LINE', '不正な年を補正', { original: dateParts[0], corrected: year });
        }
        
        var id = 'res-' + year + '-' + month + '-' + String(i + 1).padStart(3, '0');
        
        // 重複チェック - 既に同じIDが存在する場合はスキップ
        if (existingIds[id]) {
          GRMLogger.warn('LINE', '重複IDをスキップ', { id: id });
          continue;
        }
        
        // IDを追加して他の重複も防ぐ
        res.id = id;
        
        // カレンダー登録
        var eventId = '';
        try {
          eventId = GRMCalendar.createEvent(res);
          if (eventId) calendarRegistered++;
        } catch (e) {
          GRMLogger.warn('LINE', 'カレンダー登録スキップ', { error: e.message });
        }
        
        // スプレッドシート登録（カレンダー登録済みなら confirmed）
        var status = eventId ? 'confirmed' : 'pending';
        sheet.appendRow([id, today, res.date, res.weekday, res.course, res.time, status, eventId, now, '100', 'line-register', 'LINE経由登録']);
      }
      
      PropertiesService.getScriptProperties().deleteProperty('PENDING_RESERVATIONS');
      PropertiesService.getScriptProperties().setProperty('GRM_MONITORING_ACTIVE', 'false');
      
      var message = reservations.length + '件の予約を登録しました\n' + calendarRegistered + '件をGoogleカレンダーに登録しました';
      LINE.sendTextMessage(message);
      GRMLogger.info('LINE', 'LINE経由で一括登録完了', { sheet: reservations.length, calendar: calendarRegistered });
      
    } catch (e) {
      LINE.sendTextMessage('登録エラー: ' + e.message);
      GRMLogger.error('LINE', '一括登録エラー', { error: e.message });
    }
    return;
  }
  
  // 「キャンセル」コマンド
  if (text === 'キャンセル' || textLower === 'cancel') {
    PropertiesService.getScriptProperties().deleteProperty('PENDING_RESERVATIONS');
    LINE.sendTextMessage('登録待ちデータをキャンセルしました');
    return;
  }
  
  // 「ステータス」コマンド
  if (text === 'ステータス' || textLower === 'status') {
    var stats = BrainManager.getStats();
    LINE.sendTextMessage('GRM ステータス\n\n今後の予約: ' + stats.upcoming + '件\n確定済み: ' + stats.confirmed + '件\n承認待ち: ' + stats.pending + '件');
    return;
  }
  
  // 「ヘルプ」コマンド
  if (text === 'ヘルプ' || textLower === 'help') {
    LINE.sendTextMessage('GRM ヘルプ\n\n「登録」- 予約をスプレッドシート＋カレンダーに一括登録\n「キャンセル」- 登録待ちデータを削除\n「ステータス」- 予約状況を確認');
    return;
  }
}
