# Jev 玩华容道

想直接和 Jev 玩华容道赛跑？[下载 Windows 便携版 EXE](https://github.com/HamsterPark/Jev-Xiangqi/releases/download/v1.1.0/Jev-Games-1.1.0-x64-portable.exe)，双击打开，输入自己的 [Jev API key](https://www.jevai.org/jev-api) 即可开始；程序内可切换中文与英文。无需安装 Node.js 或部署服务，对弈时需要联网。

经典 4×5「横刀立马」华容道的通关回放。网页从仓库里的 `trace/jev-solved.json` 读取完整棋谱，先核对每一步是否合法、曹操是否到达底部出口，再开放播放、暂停、单步、重开和调速。访客打开页面时不会调用 Jev API。

## 双棋盘竞速模块

`assets/js/huarongdao-race.js` 提供可嵌入桌面应用的实时竞速规则。Jev 控制左侧棋盘、玩家控制右侧棋盘，双方从相同且独立的经典开局出发，玩家先手，严格轮流各移动一个滑块一格。任一方先将曹操移至底部出口就立即获胜。玩家可走任意合法滑动；Jev 的候选由本地最短距离表筛选，每步都将剩余最短距离减少一。这是**路径引导的 Jev 选择**，不是 Jev 完全独立求解。每个 Jev 回合仍会向 Jev API 请求一次选择；API 失败时抛出错误并保持棋局原状，不会用本地走法冒充 Jev。

集成方应在可信的主进程中保管用户本次输入的 API key 与权威比赛状态，key 不落盘。除首次将 key 提交给主进程外，界面在比赛中只发送玩家选择的走法 ID，不传整份可伪造的比赛状态。模块导出 `createRaceState()`、`playRaceMove(race, side, moveId)`、`requestJevMove(race, key)`，以及防御性重放验证 `validateRaceState(race)`。`getShortestPathMoves(board)` 位于 `assets/js/huarongdao-distances.js`；它在第一次使用时计算状态图并缓存。已有的网页仍只是棋谱回放；这个竞速模块供桌面应用使用。

## 棋谱如何录制

`scripts/record.mjs` 在本地计算每个可达局面到出口的最短距离。录制时，它只把能令剩余最短距离减少一步的走法交给 Jev 选择；当这样的走法只有一个时，脚本按最短路径继续。这保证棋谱通关，也意味着它是一局**有路径引导的 Jev 选择记录**，并非 Jev 在所有合法走法中独立解题。每一步的 `source` 和候选数都写入棋谱，网页也会说明引导方式。

脚本只从本地环境变量 `JEV_API_KEY` 读取密钥。录制失败时，已完成的步骤保存在被 Git 忽略的 `trace/.record-checkpoint.json` 中；再次运行会校验并接着录。若 Jev 的当日请求额度耗尽，`--finish-guided` 会保留原始检查点并用离线最短路径完成余下棋步，新增的多候选步骤标记为 `guided`。只有整局通关并通过规则校验后，才会写入公开棋谱。

```sh
node scripts/record.mjs --verify   # 验证状态图及 116 步最短距离，不调用 API
node scripts/record.mjs            # 需要预先设置 JEV_API_KEY
node scripts/record.mjs --finish-guided # 无 API 调用，从检查点引导完成
npm test                           # 验证走法与棋谱规则
```

棋谱格式：

```json
{
  "format": "jev-huarongdao-trace-v1",
  "title": "Jev 的华容道通关记录",
  "metadata": {
    "model": "typesafe/jev-1.13",
    "guidance": {
      "kind": "exact-shortest-distance",
      "description": "……"
    }
  },
  "moves": [
    {
      "move": "S1:D",
      "source": "jev",
      "candidateCount": 2,
      "candidates": ["S1:D", "S2:D"],
      "confidence": 0.5,
      "probabilities": { "S1:D": 0.5, "S2:D": 0.5 }
    }
  ]
}
```

`source: "jev"` 表示 Jev 从多个最短解候选中选择；`source: "forced"` 表示该步只有一个**最短解延续**，仍可能存在其他合法但更慢的走法；`source: "guided"` 表示离线求解器从多个最短解候选中选择。实际录制中，Jev 完成了前 75 步中的 28 次多候选选择，之后因当日请求额度耗尽，余下步骤由路径引导完成。每类步骤的数量也保存在棋谱元数据中。

## 本地预览

录制完成后，在仓库根目录启动任意静态文件服务器，例如 `python -m http.server 8000`，打开 `http://localhost:8000/`。页面可直接部署到 GitHub Pages；不需要后端。
