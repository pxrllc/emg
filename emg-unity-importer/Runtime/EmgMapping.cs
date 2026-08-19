using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace Emg.Runtime
{
    // mapping.json (v0.3.0+) のパース結果。emg-mapping-spec.md 参照。
    [Serializable]
    public class EmgMapping
    {
        public string avatarId;
        public EmgBaseMapping baseMapping;

        // JSON の "expressions" は表情名をキーとする任意キーのオブジェクトで、
        // JsonUtility はこれをデシリアライズできない。フィールド名を JSON キーと
        // 意図的に変えることで JsonUtility.FromJson からは未知のキーとして無視させ、
        // EmgMappingJsonUtil.ParseMapping が手動でここに詰め直す。
        public List<EmgExpressionEntry> expressionList = new List<EmgExpressionEntry>();

        public EmgExpressionEntry FindExpression(string name)
        {
            return expressionList?.Find(e => e.name == name);
        }
    }

    [Serializable]
    public class EmgBaseMapping
    {
        public string blinkPartKey;
        public EmgBlinkTextures blinkParts;
        public EmgBlinkTextures blink;
        public string lipSyncPartKey;
        public EmgLipSyncTextures lipSyncParts;
        public EmgLipSyncTextures lipSync;
    }

    [Serializable]
    public class EmgBlinkTextures
    {
        public string open;
        public string half;
        public string closed;
    }

    [Serializable]
    public class EmgLipSyncTextures
    {
        public string open; // 汎用の「発話中」フォールバック（母音不問）。lipSyncParts では未使用。
        public string a;
        public string i;
        public string u;
        public string e;
        public string o;
        public string n;
    }

    [Serializable]
    public class EmgExpression
    {
        public string eyebrow;
        public string[] other;
        public EmgExpressionOverrides overrides;

        // JSON の "parts" は Record<partID, string[]> で、"expressions" と同じ理由で
        // JsonUtility では扱えない。同じ回避策（フィールド名を変える）を適用し、
        // EmgMappingJsonUtil が個別にパースして詰める。
        public List<EmgPartLayerEntry> partsList = new List<EmgPartLayerEntry>();
    }

    [Serializable]
    public class EmgExpressionOverrides
    {
        public EmgBlinkTextures blink;
        public EmgLipSyncTextures lipSync;
    }

    [Serializable]
    public class EmgExpressionEntry
    {
        public string name;
        public EmgExpression value;
    }

    [Serializable]
    public class EmgPartLayerEntry
    {
        public string partID;
        public string[] layerIDs;
    }

    /// <summary>
    /// mapping.json のうち JsonUtility が扱えない動的キーオブジェクト（expressions, parts）を
    /// 手動でパースするための最小限の JSON ユーティリティ。新規の JSON ライブラリ依存を避けるため、
    /// 文字列リテラルとエスケープを考慮した括弧の深さ追跡だけで top-level のキー/値ペアに分割する。
    /// </summary>
    public static class EmgMappingJsonUtil
    {
        [Serializable]
        private class StringArrayWrapper { public string[] items; }

        public static EmgMapping ParseMapping(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;

            var mapping = JsonUtility.FromJson<EmgMapping>(text);
            if (mapping == null) return null;
            if (mapping.expressionList == null) mapping.expressionList = new List<EmgExpressionEntry>();

            string expressionsJson = FindTopLevelValue(text, "expressions");
            if (!string.IsNullOrEmpty(expressionsJson))
            {
                foreach (var entry in SplitObjectEntries(expressionsJson))
                {
                    string name = entry.Item1;
                    string valueJson = entry.Item2;

                    var expr = JsonUtility.FromJson<EmgExpression>(valueJson) ?? new EmgExpression();
                    if (expr.partsList == null) expr.partsList = new List<EmgPartLayerEntry>();

                    string partsJson = FindTopLevelValue(valueJson, "parts");
                    if (!string.IsNullOrEmpty(partsJson))
                    {
                        foreach (var partEntry in SplitObjectEntries(partsJson))
                        {
                            expr.partsList.Add(new EmgPartLayerEntry
                            {
                                partID = partEntry.Item1,
                                layerIDs = ParseStringArray(partEntry.Item2)
                            });
                        }
                    }

                    mapping.expressionList.Add(new EmgExpressionEntry { name = name, value = expr });
                }
            }

            return mapping;
        }

        public static string[] ParseStringArray(string arrJson)
        {
            if (string.IsNullOrEmpty(arrJson)) return new string[0];
            string wrapped = "{\"items\":" + arrJson + "}";
            var w = JsonUtility.FromJson<StringArrayWrapper>(wrapped);
            return w?.items ?? new string[0];
        }

        public static string FindTopLevelValue(string json, string key)
        {
            foreach (var entry in SplitObjectEntries(json))
                if (entry.Item1 == key) return entry.Item2;
            return null;
        }

        // json が指す最初の {...} オブジェクトを top-level のキー/値ペアに分割する。
        // 値の JSON 文字列表現（トリム済み）をそのまま返すので、呼び出し側で
        // JsonUtility.FromJson なり再帰的な SplitObjectEntries なりに渡せる。
        public static List<Tuple<string, string>> SplitObjectEntries(string json)
        {
            var result = new List<Tuple<string, string>>();
            if (string.IsNullOrEmpty(json)) return result;

            int i = 0;
            int n = json.Length;
            while (i < n && json[i] != '{') i++;
            if (i >= n) return result;
            i++; // skip '{'

            while (true)
            {
                while (i < n && (char.IsWhiteSpace(json[i]) || json[i] == ',')) i++;
                if (i >= n || json[i] == '}') break;
                if (json[i] != '"') break; // 不正な形式は打ち切り

                string key = ReadJsonString(json, ref i);

                while (i < n && char.IsWhiteSpace(json[i])) i++;
                if (i < n && json[i] == ':') i++;
                while (i < n && char.IsWhiteSpace(json[i])) i++;

                int valueStart = i;
                if (i < n && (json[i] == '{' || json[i] == '['))
                {
                    char open = json[i];
                    char close = open == '{' ? '}' : ']';
                    int depth = 0;
                    bool inString = false;
                    for (; i < n; i++)
                    {
                        char c = json[i];
                        if (inString)
                        {
                            if (c == '\\') { i++; continue; }
                            if (c == '"') inString = false;
                            continue;
                        }
                        if (c == '"') { inString = true; continue; }
                        if (c == open) depth++;
                        else if (c == close)
                        {
                            depth--;
                            if (depth == 0) { i++; break; }
                        }
                    }
                }
                else if (i < n && json[i] == '"')
                {
                    ReadJsonString(json, ref i);
                }
                else
                {
                    while (i < n && json[i] != ',' && json[i] != '}') i++;
                }

                string value = json.Substring(valueStart, i - valueStart).Trim();
                result.Add(Tuple.Create(key, value));
            }

            return result;
        }

        private static string ReadJsonString(string json, ref int i)
        {
            int n = json.Length;
            var sb = new StringBuilder();
            i++; // skip opening quote
            while (i < n && json[i] != '"')
            {
                if (json[i] == '\\' && i + 1 < n)
                {
                    char esc = json[i + 1];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (i + 5 < n)
                            {
                                string hex = json.Substring(i + 2, 4);
                                if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int code))
                                    sb.Append((char)code);
                                i += 4;
                            }
                            break;
                        default: sb.Append(esc); break;
                    }
                    i += 2;
                }
                else
                {
                    sb.Append(json[i]);
                    i++;
                }
            }
            i++; // skip closing quote
            return sb.ToString();
        }
    }
}
