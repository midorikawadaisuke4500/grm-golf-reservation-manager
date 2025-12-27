/**
 * Golf Reservation Manager (GRM) - Calendar
 * カレンダー操作モジュール
 * 
 * Stage 4: Googleカレンダーへのイベント登録
 * Stage 6: マージ機能の一部
 */

const GRMCalendar = {
  SYSTEM_TAG: '[System:GolfMgr]',
  
  /**
   * 予約をカレンダーに登録
   * @param {Object} reservation - 予約情報
   * @returns {string} 作成されたイベントID
   */
  createEvent(reservation) {
    GRMLogger.info('Stage4', 'カレンダー登録開始', { 
      date: reservation.date,
      time: reservation.time
    });
    
    try {
      const calendarId = Config.get('CALENDAR_ID');
      const calendar = CalendarApp.getCalendarById(calendarId);
      
      if (!calendar) {
        throw new Error(`カレンダーが見つかりません: ${calendarId}`);
      }
      
      // 重複チェック
      const existingEvent = this.findExistingEvent(calendar, reservation);
      if (existingEvent) {
        GRMLogger.warn('Stage4', 'イベント重複検出', { 
          existingId: existingEvent.getId() 
        });
        return existingEvent.getId();
      }
      
      // イベント作成
      const startTime = this.createDateTime(reservation.date, '06:00');
      const endTime = this.createDateTime(reservation.date, '15:00');
      
      const title = `【外出】ゴルフ 麻倉 ${reservation.time} 残数${reservation.remainingSlots || 3}`;
      
      const description = `${this.SYSTEM_TAG}
コース: ${reservation.course}
スタート時間: ${reservation.time}
予約ID: ${reservation.id}

---
このイベントはGRMシステムによって自動登録されました。`;
      
      const event = calendar.createEvent(title, startTime, endTime, {
        description: description,
        location: '麻倉ゴルフ倶楽部'
      });
      
      const eventId = event.getId();
      
      GRMLogger.info('Stage4', 'カレンダー登録完了', { eventId });
      GRMLogger.logTransaction('Stage4', 'CALENDAR_CREATE', reservation.id, 'success', {
        eventId,
        date: reservation.date
      });
      
      return eventId;
      
    } catch (e) {
      GRMLogger.error('Stage4', 'カレンダー登録エラー', { 
        error: e.message,
        reservation 
      });
      throw e;
    }
  },

  /**
   * 既存イベントを検索
   */
  findExistingEvent(calendar, reservation) {
    const date = new Date(reservation.date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const events = calendar.getEvents(startOfDay, endOfDay);
    
    for (const event of events) {
      const desc = event.getDescription() || '';
      if (desc.includes(this.SYSTEM_TAG) && desc.includes(reservation.id)) {
        return event;
      }
    }
    
    return null;
  },

  /**
   * イベントを更新
   */
  updateEvent(eventId, updates) {
    try {
      const calendarId = Config.get('CALENDAR_ID');
      const calendar = CalendarApp.getCalendarById(calendarId);
      const event = calendar.getEventById(eventId);
      
      if (!event) {
        throw new Error(`イベントが見つかりません: ${eventId}`);
      }
      
      if (updates.title) {
        event.setTitle(updates.title);
      }
      
      if (updates.description) {
        event.setDescription(updates.description);
      }
      
      GRMLogger.info('Stage4', 'イベント更新完了', { eventId });
      return true;
      
    } catch (e) {
      GRMLogger.error('Stage4', 'イベント更新エラー', { error: e.message });
      return false;
    }
  },

  /**
   * イベントを削除（またはキャンセル済みに更新）
   */
  cancelEvent(eventId, deleteEvent = false) {
    try {
      const calendarId = Config.get('CALENDAR_ID');
      const calendar = CalendarApp.getCalendarById(calendarId);
      const event = calendar.getEventById(eventId);
      
      if (!event) {
        GRMLogger.warn('Stage5', 'キャンセル対象イベントなし', { eventId });
        return true;
      }
      
      if (deleteEvent) {
        event.deleteEvent();
        GRMLogger.info('Stage5', 'イベント削除完了', { eventId });
      } else {
        // タイトルにキャンセル済みを追加
        const currentTitle = event.getTitle();
        event.setTitle(`【キャンセル】${currentTitle}`);
        GRMLogger.info('Stage5', 'イベントキャンセル済み更新', { eventId });
      }
      
      return true;
      
    } catch (e) {
      GRMLogger.error('Stage5', 'イベントキャンセルエラー', { error: e.message });
      return false;
    }
  },

  /**
   * 日時オブジェクトを作成
   */
  createDateTime(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0);
  },

  /**
 * 子予定（GRMシステム登録）を検索
 */
findChildEvents(date) {
  try {
    const calendarId = Config.get('CALENDAR_ID');
    const calendar = CalendarApp.getCalendarById(calendarId);
    
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const allEvents = calendar.getEvents(startOfDay, endOfDay);
    const childEvents = [];
    
    for (const event of allEvents) {
      const desc = event.getDescription() || '';
      // システムタグがあるイベントはGRM登録（子予定）
      if (desc.includes(this.SYSTEM_TAG)) {
        childEvents.push({
          id: event.getId(),
          title: event.getTitle(),
          startTime: event.getStartTime(),
          endTime: event.getEndTime(),
          description: desc
        });
      }
    }
    
    return childEvents;
    
  } catch (e) {
    GRMLogger.error('Stage6', '子予定検索エラー', { error: e.message });
    return [];
  }
},

  /**
 * 親予定（手動登録）を検索
 */
findParentEvent(date) {
  try {
    const calendarId = Config.get('CALENDAR_ID');
    const calendar = CalendarApp.getCalendarById(calendarId);
    
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const allEvents = calendar.getEvents(startOfDay, endOfDay);
    
    // マージ設定を取得
    const titleKeywords = (Config.get('MERGE_TITLE_KEYWORDS') || 'ゴルフ,麻倉').split(',');
    const locationKeyword = Config.get('MERGE_LOCATION') || '麻倉ゴルフ倶楽部';
    
    for (const event of allEvents) {
      const desc = event.getDescription() || '';
      const title = event.getTitle() || '';
      const location = event.getLocation() || '';
      
      // システムタグがないイベントが親候補
      if (!desc.includes(this.SYSTEM_TAG)) {
        // タイトルまたは場所でゴルフ関連をチェック
        const matchesTitle = titleKeywords.some(kw => title.includes(kw));
        const matchesLocation = location.includes(locationKeyword);
        
        if (matchesTitle || matchesLocation) {
          return {
            id: event.getId(),
            title: title,
            startTime: event.getStartTime(),
            endTime: event.getEndTime(),
            description: desc,
            location: location,
            event: event
          };
        }
      }
    }
    
    return null;
    
  } catch (e) {
    GRMLogger.error('Stage6', '親予定検索エラー', { error: e.message });
    return null;
  }
}
};
