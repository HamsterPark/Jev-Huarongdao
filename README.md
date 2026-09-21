# Jev 玩华容道

Jev 在经典 4×5「横刀立马」华容道棋盘上自动选择下一步。页面展示棋盘、选择、步数和走棋记录，可暂停、单步、重开和调节速度。规则代码负责验证每个滑块的移动，并排除近期重复局面；Jev 决定最终落子。即时选择并不保证能走出谜题。

静态页面部署在 GitHub Pages。Jev API 密钥由 [Jev-Xiangqi 仓库中的 Worker](https://github.com/HamsterPark/Jev-Xiangqi/tree/main/worker) 持有，绝不放在公开网页中。

## 本地运行

```sh
python -m http.server 8000
```

打开 `http://localhost:8000/`，点击“走一步”或“开始演示”。需要先部署 Worker 并将 `index.html` 中 `jev-api-endpoint` 的 `content` 设为它的 `/api/move` 地址。`npm test` 验证滑块规则。
