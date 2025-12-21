/**
 * Golf Reservation Manager (GRM) - Logger
 * ログ管理モジュール
 * 
 * 詳細ログをError_Logシートに出力し、AIによる分析を可能にする
 */

const GRMLogger = {
  LOG_LEVELS: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  },

  /**
   * ログを出力
   * @param {string} level - ログレベル
   * @param {string} stage - 処理ステージ (Stage0, Stage1, etc.)
   * @param {string} message - メッセージ
   * @param {Object} data - 追加データ
   */
  log(level, stage, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      stage,
      message,
      data: JSON.stringify(data),
      executionId: this.getExecutionId()
    };
    
    // コンソールにも出力
    console.log(`[${level}] [${stage}] ${message}`, data);
    
    // シートに書き込み
    this.writeToSheet(logEntry);
    
    // エラーの場合は管理者に通知
    if (level === this.LOG_LEVELS.ERROR) {
      this.notifyAdmin(logEntry);
    }
  },

  /**
   * デバッグログ
   */
  debug(stage, message, data = {}) {
    this.log(this.LOG_LEVELS.DEBUG, stage, message, data);
  },

  /**
   * 情報ログ
   */
  info(stage, message, data = {}) {
    this.log(this.LOG_LEVELS.INFO, stage, message, data);
  },

  /**
   * 警告ログ
   */
  warn(stage, message, data = {}) {
    this.log(this.LOG_LEVELS.WARN, stage, message, data);
  },

  /**
   * エラーログ
   */
  error(stage, message, data = {}) {
    // スタックトレースを追加
    if (data.error && data.error.stack) {
      data.stackTrace = data.error.stack;
    }
    this.log(this.LOG_LEVELS.ERROR, stage, message, data);
  },

  /**
   * 実行IDを取得（セッション識別用）
   */
  getExecutionId() {
    const cache = CacheService.getScriptCache();
    let execId = cache.get('CURRENT_EXECUTION_ID');
    if (!execId) {
      execId = Utilities.getUuid();
      cache.put('CURRENT_EXECUTION_ID', execId, 3600);
    }
    return execId;
  },

  /**
   * シートにログを書き込み
   */
  writeToSheet(logEntry) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let logSheet = ss.getSheetByName(Config.SHEET_NAMES.ERROR_LOG);
      
      if (!logSheet) {
        logSheet = this.initLogSheet(ss);
      }
      
      logSheet.appendRow([
        logEntry.timestamp,
        logEntry.level,
        logEntry.stage,
        logEntry.message,
        logEntry.data,
        logEntry.executionId
      ]);
    } catch (e) {
      console.error('ログ書き込みエラー:', e);
    }
  },

  /**
   * ログシートの初期化
   */
  initLogSheet(ss) {
    const logSheet = ss.insertSheet(Config.SHEET_NAMES.ERROR_LOG);
    logSheet.getRange('A1:F1').setValues([
      ['Timestamp', 'Level', 'Stage', 'Message', 'Data', 'ExecutionID']
    ]);
    logSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#4a4a4a');
    logSheet.setFrozenRows(1);
    return logSheet;
  },

  /**
   * 管理者に通知
   */
  notifyAdmin(logEntry) {
    try {
      const adminEmail = Config.get('ADMIN_EMAIL');
      if (adminEmail) {
        MailApp.sendEmail({
          to: adminEmail,
          subject: `[GRM ERROR] ${logEntry.stage}: ${logEntry.message}`,
          body: `
GRM システムエラー通知

Stage: ${logEntry.stage}
Message: ${logEntry.message}
Timestamp: ${logEntry.timestamp}
Execution ID: ${logEntry.executionId}

Data:
${logEntry.data}
          `.trim()
        });
      }
    } catch (e) {
      console.error('管理者通知エラー:', e);
    }
  },

  /**
   * トランザクションログを記録
   */
  logTransaction(stage, action, reservationId, status, details = {}) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let transSheet = ss.getSheetByName(Config.SHEET_NAMES.TRANSACTION_LOG);
      
      if (!transSheet) {
        transSheet = ss.insertSheet(Config.SHEET_NAMES.TRANSACTION_LOG);
        transSheet.getRange('A1:F1').setValues([
          ['Timestamp', 'Stage', 'Action', 'ReservationID', 'Status', 'Details']
        ]);
        transSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#4a4a4a');
        transSheet.setFrozenRows(1);
      }
      
      transSheet.appendRow([
        new Date().toISOString(),
        stage,
        action,
        reservationId || '',
        status,
        JSON.stringify(details)
      ]);
    } catch (e) {
      console.error('トランザクションログエラー:', e);
    }
  }
};
