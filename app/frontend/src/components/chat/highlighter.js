// Syntax highlighting is loaded on first use so highlight.js stays out of the initial bundle.
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import csharp from "highlight.js/lib/languages/csharp";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import kotlin from "highlight.js/lib/languages/kotlin";
import swift from "highlight.js/lib/languages/swift";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import markdown from "highlight.js/lib/languages/markdown";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import plaintext from "highlight.js/lib/languages/plaintext";

const languages = {
  javascript, typescript, python, xml, css, scss, json, sql, csharp, java, cpp, c,
  bash, shell, powershell, dos, go, rust, php, ruby, kotlin, swift, yaml, ini,
  markdown, diff, dockerfile, plaintext,
};

for (const [name, definition] of Object.entries(languages)) {
  hljs.registerLanguage(name, definition);
}

export const AUTO_DETECT_SUBSET = [
  "javascript", "typescript", "python", "xml", "css", "json", "sql", "csharp", "java",
  "cpp", "bash", "powershell", "go", "rust", "php", "ruby", "yaml",
];

export function highlight(code, language) {
  if (language && hljs.getLanguage(language)) {
    return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language };
  }
  const auto = hljs.highlightAuto(code, AUTO_DETECT_SUBSET);
  return { html: auto.value, language: auto.relevance >= 5 ? auto.language : "" };
}
