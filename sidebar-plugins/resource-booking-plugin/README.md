# 飞书多维表格边栏插件 Demo

这是一个最小可测试的边栏插件：打开多维表格右侧栏后，点击按钮读取当前表的表名、字段列表和记录数量。

## 本地运行

```bat
cd /d P:\0、工作学习\3、工具制作\1-网页版工具\飞书开发\lark-sidebar-field-inspector
npm install
npm run dev
```

终端里看到类似下面的地址：

```txt
Local: http://localhost:5173/
```

然后在飞书多维表格里：

```txt
插件 → 自定义插件 → + 新增插件
```

填写：

```txt
插件名称：字段读取测试
服务地址：http://localhost:5173/
```

打开插件后点击“读取当前表”。

## 打包

```bat
npm run build
```

构建产物在 `dist/`，`package.json` 里已经配置 `"output": "dist"`，`vite.config.ts` 里也已经配置 `base: './'`。
