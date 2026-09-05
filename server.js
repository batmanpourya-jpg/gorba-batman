const express = require('express');
const path = require('path');
const app = express();

// استفاده از path.join برای شناسایی درست پوشه public در Vercel
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// این خط حتماً باید در انتها باشد
module.exports = app;

// برای اجرای محلی
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
