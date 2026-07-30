const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse'); // Thư viện đọc text từ PDF
const { GoogleGenAI } = require('@google/genai'); // Google GenAI SDK chính thức

const app = express();
const PORT = process.env.PORT || 3000;

// Khởi tạo Gemini AI Client (Sử dụng API Key từ hằng số môi trường)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Cấu hình thư mục upload (Tương thích bộ nhớ tạm /tmp trên Render)
const uploadDir = process.env.RENDER ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  secret: 'math-hoangyen-hierarchy-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 8 * 3600000 }
}));

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'Admin') return next();
  res.status(403).send('Từ chối truy cập: Quyền Hạn Bắt Buộc là Admin/Giáo viên!');
}

let db;
const dbPath = process.env.RENDER ? path.join('/tmp', 'math_hoangyen.db') : path.join(__dirname, 'math_hoangyen.db');

function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch (err) {
      console.error('Lỗi lưu Database:', err);
    }
  }
}

function parseResult(res) {
  if (!res || res.length === 0) return [];
  const columns = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => { obj[col] = row[idx]; });
    return obj;
  });
}

async function initDB() {
  try {
    const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const SQL = await initSqlJs({
      locateFile: file => fs.existsSync(wasmPath) ? wasmPath : `https://sql.js.org/dist/${file}`
    });

    db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

    db.run(`
      CREATE TABLE IF NOT EXISTS math_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        level TEXT NOT NULL,
        grade_class TEXT NOT NULL,
        topic TEXT,
        description TEXT,
        pdf_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS math_quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER,
        question TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_option TEXT NOT NULL,
        explanation TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS math_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        lesson_id INTEGER,
        score INTEGER,
        status TEXT,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    saveDatabase();
    console.log('✅ Cơ sở dữ liệu SQLite đã sẵn sàng!');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo DB:', err);
  }
}

// ----------------- ROUTES ----------------- //

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Đăng Nhập - Math HoangYen</title>
      <style>
        body { font-family: sans-serif; background: #e0f2fe; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 30px; border-radius: 12px; width: 100%; max-width: 380px; border-top: 5px solid #0284c7; }
        h2 { text-align: center; color: #0284c7; margin-top:0; }
        input { width: 100%; padding: 10px; margin: 8px 0 15px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; background: #0284c7; color: white; padding: 11px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📐 Đăng Nhập Hệ Thống</h2>
        <form action="/login" method="POST">
          <label>Tên đăng nhập:</label>
          <input type="text" name="username" required placeholder="admin hoặc hocsinh">
          <label>Mật khẩu:</label>
          <input type="password" name="password" required placeholder="123456">
          <button type="submit">Vào Hệ Thống</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '123456') {
    req.session.user = { username: 'admin', role: 'Admin' };
    res.redirect('/');
  } else if (username === 'hocsinh' && password === '123456') {
    req.session.user = { username: 'hocsinh', role: 'Student' };
    res.redirect('/');
  } else {
    res.send('<script>alert("Sai tài khoản hoặc mật khẩu!"); window.location.href="/login";</script>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// API Lấy danh sách Bài học
app.get('/api/lessons', requireLogin, (req, res) => {
  if (!db) return res.json([]);
  const { grade_class } = req.query;
  let sql = 'SELECT * FROM math_lessons WHERE 1=1';
  const params = [];
  if (grade_class) {
    sql += ' AND grade_class = ?';
    params.push(grade_class);
  }
  sql += ' ORDER BY id DESC';
  res.json(parseResult(db.exec(sql, params)));
});

// API Thêm Bài học mới + Tự tạo bài tập bằng AI
app.post('/api/lessons', requireLogin, requireAdmin, upload.single('pdf'), async (req, res) => {
  const { code, title, level, grade_class, topic, description, auto_gen_quiz } = req.body;
  const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;
  
  try {
    db.run('INSERT INTO math_lessons (code, title, level, grade_class, topic, description, pdf_path) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [code, title, level, grade_class, topic, description || '', pdfPath]);
    
    // Lấy ID bài học vừa lưu
    const lastIdRes = db.exec('SELECT last_insert_rowid() as id');
    const lessonId = lastIdRes[0].values[0][0];

    // NẾU TÍCH CHỌN TỰ ĐỘNG TẠO BÀI TẬP VÀ CÓ FILE PDF
    if (auto_gen_quiz === 'on' && req.file) {
      const fullPath = path.join(uploadDir, req.file.filename);
      const dataBuffer = fs.readFileSync(fullPath);
      
      // 1. Đọc nội dung văn bản từ PDF
      const pdfData = await pdfParse(dataBuffer);
      const textContent = pdfData.text.slice(0, 4000); // Giới hạn ký tự tối ưu hóa tốc độ AI

      if (textContent.trim().length > 50) {
        // 2. Tạo prompt yêu cầu Gemini sinh trắc nghiệm
        const prompt = `Bạn là chuyên gia soạn đề thi Toán học Việt Nam. Dựa vào nội dung tài liệu toán sau đây:
---
${textContent}
---
Hãy tạo 3 câu hỏi trắc nghiệm khách quan phù hợp cho trình độ ${grade_class}. 
Trả về dữ liệu dưới dạng JSON Array duy nhất, KHÔNG chứa thêm văn bản giải thích ngoài JSON, theo cấu trúc chính xác sau:
[
  {
    "question": "Nội dung câu hỏi?",
    "option_a": "Lựa chọn A",
    "option_b": "Lựa chọn B",
    "option_c": "Lựa chọn C",
    "option_d": "Lựa chọn D",
    "correct_option": "A",
    "explanation": "Giải thích chi tiết ngắn gọn"
  }
]`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        // Xử lý chuỗi JSON kết quả trả về từ Gemini
        const rawText = response.text.replace(/```json|
