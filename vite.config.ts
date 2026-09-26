import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  /**
   * เสิร์ฟจาก root ของโดเมน (Cloudflare Pages) — ต้องเป็น '/' ไม่ใช่ './'
   * เพราะแอปใช้ client-side routing: ถ้าใช้ path แบบ relative แล้วเปิด deep link
   * เช่น /issues/iss_123 เบราว์เซอร์จะไปหา /issues/assets/... แล้ว 404 จอขาว
   *
   * ถ้าต้องการไฟล์ที่ดับเบิลคลิกเปิดตรง ๆ ได้ (file://) ให้ใช้ `npm run build:file`
   * ซึ่งสั่ง --base=./ ทับค่านี้ (main.tsx จะสลับไปใช้ HashRouter ให้เองเมื่อเป็น file://)
   */
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      /**
       * ทะเบียนพนักงานจริง (roster.data.ts) ไม่ขึ้น git — มีในเครื่องใช้ตัวจริง
       * clone มาใหม่ยังไม่มี ใช้ไฟล์ตัวอย่างที่เป็นข้อมูลสมมติแทน build จึงไม่พัง
       * (build ของจริงตัดทะเบียนทิ้งทั้งก้อนอยู่แล้ว ดู boot() ใน src/main.tsx)
       */
      '@roster-data': path.resolve(
        __dirname,
        fs.existsSync(path.resolve(__dirname, 'src/lib/roster.data.ts'))
          ? 'src/lib/roster.data.ts'
          : 'src/lib/roster.data.example.ts',
      ),
    },
  },
  server: { port: 8081, host: true },
  preview: { port: 8081 },
});
