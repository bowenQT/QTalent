# 文档解析依赖核对

用户2026-10-25 17:12 UTC明确批准mammoth/pdfjs-dist；父授予本任务本批package.json与pnpm-lock唯一文档解析写入责任。仅新增两个直接依赖，从标准 `https://registry.npmjs.org/` 安装，禁用安装脚本，精确版本及完整性写入锁文件。未加OCR、Office/Poppler或外部服务。

| 包                              | 锁定版本 | 许可证与用途                                                                            |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| mammoth                         | 1.13.0   | BSD-2-Clause；DOCX语义AST                                                               |
| pdfjs-dist                      | 6.4.299  | Apache-2.0；逐页PDF文字与非渲染结构                                                     |
| @napi-rs/canvas及11个平台可选包 | 1.0.13   | MIT；PDF.js声明的可选传递依赖，供Node兼容初始化；不是额外直接依赖，本卡不调用canvas渲染 |
| @xmldom/xmldom                  | 0.8.15   | MIT                                                                                     |
| argparse                        | 1.0.10   | MIT                                                                                     |
| base64-js                       | 1.5.1    | MIT                                                                                     |
| core-util-is                    | 1.0.3    | MIT                                                                                     |
| dingbat-to-unicode              | 1.0.2    | BSD-2-Clause                                                                            |
| duck                            | 0.1.12   | registry标BSD；已核实际LICENSE是两条款BSD                                               |
| immediate                       | 3.0.6    | MIT                                                                                     |
| inherits                        | 2.0.4    | ISC                                                                                     |
| isarray                         | 1.0.0    | MIT                                                                                     |
| jszip                           | 3.10.2   | MIT或GPL-3.0-or-later双许可；本项目选择MIT，保留包中LICENSE                             |
| lie                             | 3.3.0    | MIT                                                                                     |
| lop                             | 0.4.2    | BSD-2-Clause                                                                            |
| option                          | 0.2.4    | BSD-2-Clause                                                                            |
| pako                            | 1.0.11   | MIT AND Zlib，保留两项许可声明                                                          |
| process-nextick-args            | 2.0.1    | MIT                                                                                     |
| readable-stream                 | 2.3.8    | MIT                                                                                     |
| safe-buffer                     | 5.1.2    | MIT                                                                                     |
| setimmediate                    | 1.0.5    | MIT                                                                                     |
| sprintf-js                      | 1.0.3    | BSD-3-Clause                                                                            |
| string_decoder                  | 1.1.1    | MIT                                                                                     |
| underscore                      | 1.13.8   | MIT                                                                                     |
| util-deprecate                  | 1.0.2    | MIT                                                                                     |
| xmlbuilder                      | 10.1.1   | MIT                                                                                     |

两直接包及35个新增传递/平台锁记录共37项，均逐项读取官方npm版本metadata的license/integrity；duck与JSZip另核分发包LICENSE。原740个package/snapshot锁记录逐块比较未变，原直接/开发依赖版本全部保留；新增锁区仅追加。上游版本/API、许可或安全行为变化需重新审查并跑真实格式反例，不自动跟随latest。

解析边界与已知PDF.js私有seam见[README](README.md)，测试夹具由Python标准库可复现生成，不嵌入真实员工材料或字体文件。
