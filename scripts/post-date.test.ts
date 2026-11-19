import { test } from "node:test"
import assert from "node:assert/strict"
import { dateFromPath } from "./post-date"

test("文件名带完整时间戳", () => {
  assert.deepEqual(dateFromPath("20261118-212435-妈妈测试.html"), {
    date: "2026-11-18",
    sortKey: "20261118212435",
  })
})

test("文件名紧跟正文、无分隔的时间戳", () => {
  assert.deepEqual(dateFromPath("20260428-221424跨越鸿沟-深度阅读笔记.html"), {
    date: "2026-04-28",
    sortKey: "20260428221424",
  })
})

test("只有日期没有时分秒时补 000000", () => {
  assert.deepEqual(dateFromPath("2026-05-22-foo.html"), {
    date: "2026-05-22",
    sortKey: "20260522000000",
  })
  assert.deepEqual(dateFromPath("20260522-foo.html"), {
    date: "2026-05-22",
    sortKey: "20260522000000",
  })
})

test("目录封面 index.html 取目录名的创建时间", () => {
  assert.deepEqual(dateFromPath("20260825-114658-buffett-annual-meetings-transcripts/index.html"), {
    date: "2026-08-25",
    sortKey: "20260825114658",
  })
})

test("文件名自带日期时优先于目录名", () => {
  assert.deepEqual(dateFromPath("20260825-114658-dir/20260901-080000-child.html"), {
    date: "2026-09-01",
    sortKey: "20260901080000",
  })
})

test("多层目录逐级往上找，兼容 Windows 分隔符", () => {
  assert.equal(dateFromPath("20260825-114658-dir\\sub\\index.html")?.sortKey, "20260825114658")
})

test("路径上处处无日期返回 null，交给调用方退回 mtime", () => {
  assert.equal(dateFromPath("about/index.html"), null)
})
