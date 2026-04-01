import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'bot_data', 'database.sqlite');
const db = new Database(DB_PATH);

console.log('Iniciando migración de fechas de auditoría...');

try {
  // 1. Añadir la columna processing_timestamp si no existe
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN processing_timestamp TEXT;`);
    console.log('Columna processing_timestamp añadida.');
  } catch (e) {
    console.log('La columna processing_timestamp ya existe.');
  }

  // 2. Copiar los valores actuales de timestamp a processing_timestamp donde esté vacío
  const updateProcessingStmt = db.prepare(`
    UPDATE audit_logs 
    SET processing_timestamp = timestamp 
    WHERE processing_timestamp IS NULL OR processing_timestamp = ''
  `);
  const resultProcessing = updateProcessingStmt.run();
  console.log(`Se actualizaron ${resultProcessing.changes} registros con la fecha de procesamiento original.`);

  // 3. Extraer la fecha original del mensaje (si está disponible en el texto del mensaje o si podemos inferirla)
  // Como no guardamos el timestamp original en los registros anteriores, no podemos recuperarlo mágicamente
  // a menos que volvamos a procesar los mensajes. 
  // Sin embargo, para los registros que son de "Barrido" (ejecución en lote), sabemos que la fecha original
  // es anterior a la fecha de procesamiento.
  
  console.log('Migración completada. Los nuevos registros guardarán la fecha original del mensaje.');
  console.log('Nota: Para los registros anteriores, la fecha original y la de procesamiento serán la misma, ya que la fecha original no se guardó en su momento.');

} catch (error) {
  console.error('Error durante la migración:', error);
} finally {
  db.close();
}
