// ─── ZONA HORARIA CENTRALIZADA ──────────────────────────────────────────────
//
// Este módulo es la ÚNICA fuente de verdad sobre la zona horaria de la app.
// Centralizar aquí evita el bug clásico de JavaScript donde:
//   new Date("2026-04-23")              → se parsea como UTC midnight
//   new Date().toISOString().split('T') → devuelve la fecha en UTC, no local
//
// Si vives en México (UTC-6) y abres la app a las 18:00, ese código te
// devuelve la fecha del día siguiente porque ya pasó medianoche en UTC.
// Por eso al filtrar auditoría "del día de hoy" no aparecían los registros
// recientes: el filtro estaba pidiendo el día equivocado.
//
// Para cambiar la zona horaria de toda la app, basta con modificar la
// constante TIMEZONE de abajo.
// ─────────────────────────────────────────────────────────────────────────────

export const TIMEZONE = 'America/Mexico_City';
export const LOCALE = 'es-MX';

// Devuelve la fecha de HOY en formato "YYYY-MM-DD" según la zona horaria
// configurada (no UTC). Reemplaza al peligroso:
//   new Date().toISOString().split('T')[0]
export function getLocalDateStr(date: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(date);
}

// Devuelve la fecha y hora actual formateada en español de México.
// Usada para timestamps de auditoría y logs visibles al usuario.
export function getLocalTimestamp(date: Date = new Date()): string {
    return date.toLocaleString(LOCALE, { timeZone: TIMEZONE });
}

// Devuelve la hora actual en formato "HH:MM" (24h) según la zona horaria
// configurada. Usada por el scheduler para comparar con horarios programados.
// Reemplaza al peligroso:
//   `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes()...}`
// que dependía de la zona horaria del sistema operativo.
export function getLocalHHMM(date: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    // en-GB devuelve "HH:MM" pero algunos navegadores devuelven "24:00" en
    // lugar de "00:00" a medianoche. Normalizamos.
    return formatter.format(date).replace('24:', '00:');
}

// Devuelve los componentes de fecha y hora actuales según la zona horaria.
// Útil para schedulers que necesitan comparar día de la semana, día del mes, etc.
export interface LocalDateParts {
    year: number;
    month: number;       // 1-12 (no 0-11 como en JS Date)
    day: number;         // 1-31
    hour: number;        // 0-23
    minute: number;      // 0-59
    second: number;      // 0-59
    dayOfWeek: number;   // 0=domingo, 1=lunes, ... 6=sábado
}

export function getLocalDateParts(date: Date = new Date()): LocalDateParts {
    // Truco: usamos formatToParts para extraer los componentes en la TZ deseada.
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hour12: false
    });

    const parts = formatter.formatToParts(date);
    const get = (type: string): string => parts.find(p => p.type === type)?.value || '0';

    // 'short' weekday devuelve "Sun", "Mon"... lo convertimos a número 0-6
    const weekdayMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
    };

    let hour = parseInt(get('hour'), 10);
    if (hour === 24) hour = 0; // Normalización medianoche

    return {
        year: parseInt(get('year'), 10),
        month: parseInt(get('month'), 10),
        day: parseInt(get('day'), 10),
        hour,
        minute: parseInt(get('minute'), 10),
        second: parseInt(get('second'), 10),
        dayOfWeek: weekdayMap[get('weekday')] ?? 0
    };
}

// Parsea una fecha en formato "YYYY-MM-DD" como MEDIANOCHE LOCAL del día
// indicado (no UTC). Reemplaza al peligroso:
//   new Date("2026-04-23")  → UTC midnight = día anterior 18:00 en México
// Si la cadena no es válida, devuelve null.
//
// Para CDMX (UTC-6 sin DST), la medianoche local del 23/04 corresponde a
// las 06:00 UTC del 23/04. Este helper lo construye correctamente.
//
// IMPORTANTE: el resultado es un Date que internamente está en UTC, pero
// representa la medianoche LOCAL del día solicitado. Si lo formateas con
// la TZ correcta, verás "2026-04-23 00:00:00" (lo que esperabas).
export function parseLocalDate(dateStr: string): Date | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    // Para construir "medianoche local" sin depender de la TZ del sistema:
    // 1. Construimos UTC midnight como base (el "wall clock" del día deseado)
    // 2. Calculamos el offset de la TZ destino vs UTC
    // 3. RESTAMOS el offset: si México es UTC-6 (offset = -360 min),
    //    la medianoche local del 23/abr ocurre 6 horas DESPUÉS de UTC midnight,
    //    es decir el 23/abr a las 06:00 UTC.
    const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcMidnight));

    return new Date(utcMidnight - offsetMinutes * 60 * 1000);
}

// Igual que parseLocalDate pero devuelve el final del día (23:59:59.999).
export function parseLocalDateEndOfDay(dateStr: string): Date | null {
    const start = parseLocalDate(dateStr);
    if (!start) return null;
    // Sumamos 1 día - 1 ms para obtener 23:59:59.999 local
    return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

// Devuelve el offset (en minutos) de la zona horaria configurada respecto a UTC,
// para una fecha dada. Positivo si está al este de UTC, negativo si al oeste.
// Para México (UTC-6): devuelve -360.
//
// Usar esto en lugar de Date.getTimezoneOffset() que da el offset del sistema
// operativo, no de nuestra TZ configurada.
export function getTimezoneOffsetMinutes(date: Date = new Date()): number {
    // Truco probado: formateamos la misma fecha en la TZ destino y en UTC,
    // luego comparamos los Date resultantes. La diferencia es el offset.
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }));
    return Math.round((tzDate.getTime() - utcDate.getTime()) / (60 * 1000));
}

// Formatea un timestamp Unix (en segundos) como string legible en la TZ local.
// Usado para mostrar horas de mensajes de WhatsApp.
export function formatUnixTimestamp(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toLocaleString(LOCALE, { timeZone: TIMEZONE });
}

// Convierte un timestamp Unix (en segundos) a "YYYY-MM-DD" en la TZ local.
export function unixTimestampToLocalDateStr(unixSeconds: number): string {
    return getLocalDateStr(new Date(unixSeconds * 1000));
}
