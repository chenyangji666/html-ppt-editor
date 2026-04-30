const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// 项目根目录（editor 的上一级）
const PROJECT_ROOT = path.resolve(__dirname, '..');

// multer 配置：图片上传到 uploads/
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    cb(null, `${name}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '50mb' }));

// CORS（允许本地开发跨域）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 静态文件：编辑器界面
app.use('/editor', express.static(path.join(__dirname, 'public')));

// 静态文件：上传的图片 + 打开的远程文件
const OPENED_DIR = path.join(__dirname, 'uploads', 'opened');
fs.mkdirSync(OPENED_DIR, { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 静态文件：项目根目录（HTML PPT 文件 + html_ppt_skill 资源）
app.use('/project', express.static(PROJECT_ROOT));

// API：列出所有 HTML PPT 文件
app.get('/api/files', (req, res) => {
  const files = fs.readdirSync(PROJECT_ROOT)
    .filter(f => f.endsWith('.html') && !f.startsWith('.'))
    .map(f => ({
      name: f,
      size: fs.statSync(path.join(PROJECT_ROOT, f)).size,
      modified: fs.statSync(path.join(PROJECT_ROOT, f)).mtime
    }))
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  res.json(files);
});

// API：保存 HTML 文件（自动备份）
app.post('/api/save', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: '缺少参数' });

  let filePath;
  if (name.startsWith('uploads/opened/')) {
    // 远程打开的文件：保存到 uploads/opened/ 目录
    filePath = path.join(__dirname, name);
    if (!filePath.startsWith(OPENED_DIR)) return res.status(403).json({ error: '路径非法' });
  } else {
    // 项目内文件：保存到项目根目录
    filePath = path.join(PROJECT_ROOT, name);
    if (!filePath.startsWith(PROJECT_ROOT)) return res.status(403).json({ error: '路径非法' });
  }

  // 自动备份
  if (fs.existsSync(filePath)) {
    const backupPath = filePath + '.backup';
    fs.copyFileSync(filePath, backupPath);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  res.json({ ok: true, saved: name });
});

// API：上传图片
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' });
  res.json({
    ok: true,
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`
  });
});

// API：打开任意位置的 HTML 文件（通过文件选择对话框）
app.post('/api/open-remote', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: '缺少参数' });
  // 先剥离目录，只取文件名，再 sanitize
  let safeName = path.basename(name).replace(/[^a-zA-Z0-9_\-\.一-鿿]/g, '_');
  if (!safeName || safeName === '..' || safeName === '.') safeName = 'untitled.html';
  const filePath = path.join(OPENED_DIR, safeName);
  // 二次校验：确保最终路径在 OPENED_DIR 内
  if (!filePath.startsWith(OPENED_DIR)) return res.status(403).json({ error: '路径非法' });
  fs.writeFileSync(filePath, content, 'utf-8');
  res.json({ ok: true, url: `/uploads/opened/${safeName}`, name: safeName });
});

// 根路径重定向到编辑器
app.get('/', (req, res) => res.redirect('/editor/editor.html'));

app.listen(PORT, () => {
  console.log(`\n  HTML PPT 编辑器已启动`);
  console.log(`  打开浏览器访问: http://localhost:${PORT}\n`);
});
