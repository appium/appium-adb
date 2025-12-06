export const POWER_AC_STATES = {
  POWER_AC_ON: 'on',
  POWER_AC_OFF: 'off',
} as const;
export const GSM_CALL_ACTIONS = {
  GSM_CALL: 'call',
  GSM_ACCEPT: 'accept',
  GSM_CANCEL: 'cancel',
  GSM_HOLD: 'hold',
} as const;
export const GSM_VOICE_STATES = {
  GSM_VOICE_UNREGISTERED: 'unregistered',
  GSM_VOICE_HOME: 'home',
  GSM_VOICE_ROAMING: 'roaming',
  GSM_VOICE_SEARCHING: 'searching',
  GSM_VOICE_DENIED: 'denied',
  GSM_VOICE_OFF: 'off',
  GSM_VOICE_ON: 'on',
} as const;
export const GSM_SIGNAL_STRENGTHS = [0, 1, 2, 3, 4] as const;
export const NETWORK_SPEED = {
  GSM: 'gsm', // GSM/CSD (up: 14.4, down: 14.4).
  SCSD: 'scsd', // HSCSD (up: 14.4, down: 57.6).
  GPRS: 'gprs', // GPRS (up: 28.8, down: 57.6).
  EDGE: 'edge', // EDGE/EGPRS (up: 473.6, down: 473.6).
  UMTS: 'umts', // UMTS/3G (up: 384.0, down: 384.0).
  HSDPA: 'hsdpa', // HSDPA (up: 5760.0, down: 13,980.0).
  LTE: 'lte', // LTE (up: 58,000, down: 173,000).
  EVDO: 'evdo', // EVDO (up: 75,000, down: 280,000).
  FULL: 'full', // No limit, the default (up: 0.0, down: 0.0).
} as const;
export const SENSORS = {
  ACCELERATION: 'acceleration',
  GYROSCOPE: 'gyroscope',
  MAGNETIC_FIELD: 'magnetic-field',
  ORIENTATION: 'orientation',
  TEMPERATURE: 'temperature',
  PROXIMITY: 'proximity',
  LIGHT: 'light',
  PRESSURE: 'pressure',
  HUMIDITY: 'humidity',
  MAGNETIC_FIELD_UNCALIBRATED: 'magnetic-field-uncalibrated',
  GYROSCOPE_UNCALIBRATED: 'gyroscope-uncalibrated',
  HINGE_ANGLE0: 'hinge-angle0',
  HINGE_ANGLE1: 'hinge-angle1',
  HINGE_ANGLE2: 'hinge-angle2',
  HEART_RATE: 'heart-rate',
  RGBC_LIGHT: 'rgbc-light',
} as const;
