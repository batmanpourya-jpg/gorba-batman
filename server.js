{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "gorba-batman",
  "main": "src/index.js",
  "compatibility_date": "2026-09-05",
  "assets": {
    "directory": "./public"
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "CHAT",
        "class_name": "ChatRoom"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["ChatRoom"]
    }
  ]
}