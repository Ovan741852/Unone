// Put this file under Assets/Editor/UnoneHierarchyImporter.cs.
// It imports layout-hierarchy.v1 and creates a Canvas/Prefab from the hierarchy.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

public static class UnoneHierarchyImporter
{
    [Serializable] class LayoutFile { public LayoutRoot root; public LayoutNode[] nodes; }
    [Serializable] class LayoutRoot { public string id; public string label; public LayoutRect rect; public string[] children; }
    [Serializable] class LayoutNode { public string id; public string label; public string role; public string parent_id; public bool contains_text; public LayoutRect rect; public string[] children; }
    [Serializable] class LayoutRect { public float x; public float y; public float width; public float height; }

    [MenuItem("Tools/Unone/Import Layout Hierarchy...")]
    public static void Import()
    {
        var jsonPath = EditorUtility.OpenFilePanel("Open layout-hierarchy.v1", Application.dataPath, "json");
        if (string.IsNullOrEmpty(jsonPath)) return;
        var data = JsonUtility.FromJson<LayoutFile>(File.ReadAllText(jsonPath));
        var byId = new Dictionary<string, LayoutNode>();
        foreach (var node in data.nodes ?? Array.Empty<LayoutNode>()) if (!string.IsNullOrEmpty(node.id)) byId[node.id] = node;

        var canvas = new GameObject("ImportedLayout", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvasComponent = canvas.GetComponent<Canvas>(); canvasComponent.renderMode = RenderMode.ScreenSpaceOverlay;
        var canvasRect = canvas.GetComponent<RectTransform>(); canvasRect.anchorMin = Vector2.zero; canvasRect.anchorMax = Vector2.one; canvasRect.offsetMin = Vector2.zero; canvasRect.offsetMax = Vector2.zero;
        var rootRect = new LayoutRect { x = 0, y = 0, width = 100, height = 100 };
        foreach (var id in data.root.children ?? Array.Empty<string>()) CreateNode(id, canvas.transform, rootRect, byId);

        var folder = "Assets/ImportedLayouts"; Directory.CreateDirectory(folder);
        var prefabPath = AssetDatabase.GenerateUniqueAssetPath(folder + "/ImportedLayout.prefab");
        PrefabUtility.SaveAsPrefabAsset(canvas, prefabPath); UnityEngine.Object.DestroyImmediate(canvas);
        AssetDatabase.Refresh(); Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
        Debug.Log("Unone hierarchy imported: " + prefabPath);
    }

    static void CreateNode(string id, Transform parent, LayoutRect parentRect, Dictionary<string, LayoutNode> byId)
    {
        if (!byId.TryGetValue(id, out var node)) return;
        var go = new GameObject(string.IsNullOrEmpty(node.label) ? node.id : node.label, typeof(RectTransform));
        go.transform.SetParent(parent, false); var rect = go.GetComponent<RectTransform>(); SetRect(rect, node.rect, parentRect); AddVisual(node, go);
        foreach (var child in node.children ?? Array.Empty<string>()) CreateNode(child, rect, node.rect, byId);
    }

    static void SetRect(RectTransform target, LayoutRect value, LayoutRect parent)
    {
        if (value == null) return;
        var pw = Mathf.Max(0.01f, parent.width); var ph = Mathf.Max(0.01f, parent.height);
        var x = (value.x - parent.x) / pw; var y = (value.y - parent.y) / ph; var w = value.width / pw; var h = value.height / ph;
        target.anchorMin = new Vector2(x, 1f - y - h); target.anchorMax = new Vector2(x + w, 1f - y); target.offsetMin = Vector2.zero; target.offsetMax = Vector2.zero;
    }

    static void AddVisual(LayoutNode node, GameObject go)
    {
        var role = node.role ?? "unknown";
        if (role == "button") go.AddComponent<Button>();
        if (role == "panel" || role == "card" || role == "button" || role == "image" || role == "avatar" || role == "progress" || role == "badge")
        {
            var image = go.GetComponent<Image>() ?? go.AddComponent<Image>(); image.color = ColorFor(role);
        }
        if (node.contains_text || role == "heading" || role == "text" || role == "metric" || role == "tab" || role == "status")
        {
            var label = go.AddComponent<Text>(); label.text = node.label ?? node.id; label.color = Color.white; label.alignment = TextAnchor.MiddleCenter; label.font = Resources.GetBuiltinResource<Font>("Arial.ttf"); label.resizeTextForBestFit = true;
        }
    }

    static Color ColorFor(string role)
    {
        if (role == "button") return new Color(.78f, .55f, .22f, .9f);
        if (role == "image" || role == "avatar") return new Color(.55f, .28f, .45f, .35f);
        if (role == "progress") return new Color(.35f, .82f, .75f, .65f);
        return new Color(.08f, .22f, .26f, .65f);
    }
}
