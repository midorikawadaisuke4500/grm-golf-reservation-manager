/**
 * Golf Reservation Manager (GRM) - Mail
 * メール送信モジュール
 * 
 * Stage 0: 予約依頼メール自動送信
 * Stage 5: キャンセルメール送信
 */

const GRMMail = {
  /**
   * 予約依頼メールを送信（Stage 0）
   * 毎月1日 AM 03:00 にトリガーで実行
   */
  sendReservationRequest() {
    GRMLogger.info('Stage0', '予約依頼メール送信開始');
    
    try {
      // 4ヶ月先の月を計算
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + 4);
      const targetMonth = targetDate.getMonth() + 1;
      const targetYear = targetDate.getFullYear();
      
      // 識別子を生成（返信追跡用）
      const identifier = `[GRM-${targetYear}-${String(targetMonth).padStart(2, '0')}]`;
      
      // 時間指定（1月・2月は8時台TOP、それ以外はTOP）
      const timeRequest = (targetMonth === 1 || targetMonth === 2) 
        ? '8時台のTOPスタート' 
        : 'TOPスタート';
      
      // 対象日を生成（平日：水・木・金）
      const targetDays = this.getWeekdaysInMonth(targetYear, targetMonth, ['水', '木', '金']);
      
      // メール本文生成（識別子を本文にも埋め込む）
      const subject = `${identifier} ${targetYear}年${targetMonth}月 ゴルフ予約のお願い`;
      const body = this.generateRequestBody(targetYear, targetMonth, targetDays, timeRequest, identifier);
      
      // 送信
      const toEmail = Config.getGolfClubEmail();
      const adminEmail = Config.get('ADMIN_EMAIL');
      
      GmailApp.sendEmail(toEmail, subject, body, {
        name: '緑川',
        replyTo: adminEmail
      });
      
      // 送信したメールを取得してスレッドIDを保存
      Utilities.sleep(2000); // メール送信の反映を待つ
      const sentThreads = GmailApp.search(`subject:"${identifier}" from:me`, 0, 1);
      
      if (sentThreads.length > 0) {
        const threadId = sentThreads[0].getId();
        const messageId = sentThreads[0].getMessages()[0].getId();
        
        // 監視情報をPropertiesに保存
        const monitoringDeadline = new Date();
        monitoringDeadline.setDate(monitoringDeadline.getDate() + 14);
        
        PropertiesService.getScriptProperties().setProperties({
          'GRM_THREAD_ID': threadId,
          'GRM_MESSAGE_ID': messageId,
          'GRM_IDENTIFIER': identifier,
          'GRM_TARGET_YEAR': String(targetYear),
          'GRM_TARGET_MONTH': String(targetMonth),
          'GRM_MONITORING_ACTIVE': 'true',
          'GRM_MONITORING_START': new Date().toISOString(),
          'GRM_MONITORING_DEADLINE': monitoringDeadline.toISOString()
        });
        
        // ラベルを作成・付与
        this.applyLabel(sentThreads[0], 'GRM/予約依頼中');
        
        GRMLogger.info('Stage0', '監視情報を保存', { 
          threadId,
          identifier,
          deadline: monitoringDeadline.toISOString()
        });
        
        // 自動で3分間隔の監視を開始
        startEmailMonitoring();
      }
      
      GRMLogger.info('Stage0', '予約依頼メール送信完了', { 
        to: toEmail,
        targetMonth: `${targetYear}年${targetMonth}月`,
        dayCount: targetDays.length,
        identifier
      });
      
      GRMLogger.logTransaction('Stage0', 'SEND_REQUEST', null, 'success', {
        targetMonth: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
        dayCount: targetDays.length,
        identifier
      });
      
      return { 
        success: true, 
        targetMonth: `${targetYear}年${targetMonth}月`,
        identifier,
        monitoringStarted: true
      };
      
    } catch (e) {
      GRMLogger.error('Stage0', '予約依頼メール送信エラー', { error: e.message });
      
      // 管理者に通知
      this.notifyError('予約依頼メール送信失敗', e.message);
      
      return { success: false, error: e.message };
    }
  },

  /**
   * Gmailラベルを作成・付与
   */
  applyLabel(thread, labelName) {
    try {
      let label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        label = GmailApp.createLabel(labelName);
      }
      thread.addLabel(label);
    } catch (e) {
      GRMLogger.warn('Stage0', 'ラベル付与エラー', { error: e.message });
    }
  },

  /**
   * 月内の指定曜日を取得
   */
  getWeekdaysInMonth(year, month, weekdays) {
    const weekdayMap = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
    const targetWeekdays = weekdays.map(w => weekdayMap[w]);
    
    const days = [];
    const date = new Date(year, month - 1, 1);
    
    while (date.getMonth() === month - 1) {
      if (targetWeekdays.includes(date.getDay())) {
        days.push({
          date: new Date(date),
          day: date.getDate(),
          weekday: weekdays[targetWeekdays.indexOf(date.getDay())]
        });
      }
      date.setDate(date.getDate() + 1);
    }
    
    return days;
  },
  /**
   * 予約依頼メール本文を生成（秘書代行スタイル）
   */
  generateRequestBody(year, month, days, timeRequest, identifier = '') {
    // 日付リスト（月を明記）
    const dayList = days.map(d => `${month}月${String(d.day).padStart(2, ' ')}日（${d.weekday}）`).join('\n');
    
    // 1,2月は8時台の例を表示
    const isWinterMonth = (month === 1 || month === 2);
    const timeExample = isWinterMonth ? '8時10分' : '7時30分';
    
    return `
麻倉ゴルフ倶楽部 ご担当者様

いつも大変お世話になっております。
緑川の秘書を務めております者です。

${year}年${month}月分のゴルフ予約につきまして、
下記日程での枠確保をお願いできればと存じます。

━━━━━━━━━━━━━━━━━━━━━━━━
■ 希望日程（${year}年${month}月）
━━━━━━━━━━━━━━━━━━━━━━━━
${dayList}

■ 希望時間
${timeRequest}

■ 人数
4名（組数により調整可能）
━━━━━━━━━━━━━━━━━━━━━━━━

【ご返信のお願い】
大変恐れ入りますが、ご返信の際は下記形式にて
お日にちとお時間をお知らせいただけますと幸いです。

  例）${month}月1日（水）OUTコース ${timeExample}

※予約管理システムで自動取り込みを行っておりますため、
  上記形式でのご回答をお願い申し上げます。

ご多忙のところ恐縮ですが、
ご確認のほど何卒よろしくお願いいたします。

---
緑川 秘書
midorikawa@agentgate.jp
${identifier ? `(管理ID: ${identifier})` : ''}

【ご参考】時間帯について
・1月〜2月：8時台TOPスタート
・3月〜12月：TOPスタート（7時台）
    `.trim();
  },

  /**
   * キャンセルメールを送信（Stage 5）
   */
  sendCancellationEmail(reservation) {
    GRMLogger.info('Stage5', 'キャンセルメール送信開始', { 
      reservationId: reservation.id 
    });
    
    try {
      const date = new Date(reservation.date);
      const formattedDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
      
      const subject = `ゴルフ予約キャンセルのお願い（${formattedDate}）`;
      const body = `
麻倉ゴルフ倶楽部 御中

いつもお世話になっております。
緑川でございます。

誠に恐れ入りますが、下記の予約をキャンセルさせていただきたく、
ご連絡いたしました。

■キャンセル希望日
${formattedDate}（${reservation.weekday}）

■予約時間
${reservation.time} スタート

■コース
${reservation.course}コース

大変申し訳ございませんが、よろしくお願いいたします。

---
緑川
midorikawa@agentgate.jp
      `.trim();
      
      const toEmail = Config.getGolfClubEmail();
      const adminEmail = Config.get('ADMIN_EMAIL');
      
      GmailApp.sendEmail(toEmail, subject, body, {
        name: '緑川',
        replyTo: adminEmail
      });
      
      GRMLogger.info('Stage5', 'キャンセルメール送信完了', { 
        to: toEmail,
        date: formattedDate
      });
      
      GRMLogger.logTransaction('Stage5', 'SEND_CANCEL', reservation.id, 'success', {
        date: reservation.date
      });
      
      return { success: true };
      
    } catch (e) {
      GRMLogger.error('Stage5', 'キャンセルメール送信エラー', { 
        error: e.message,
        reservationId: reservation.id
      });
      return { success: false, error: e.message };
    }
  },

  /**
   * エラー通知
   */
  notifyError(title, message) {
    try {
      const adminEmail = Config.get('ADMIN_EMAIL');
      if (adminEmail) {
        GmailApp.sendEmail(adminEmail, `[GRM ERROR] ${title}`, message);
      }
    } catch (e) {
      console.error('エラー通知失敗:', e);
    }
  }
};

/**
 * Stage 0: 予約依頼メール送信（トリガー用関数）
 * 毎月1日 AM 03:00 に実行
 */
function triggerSendReservationRequest() {
  GRMMail.sendReservationRequest();
}
