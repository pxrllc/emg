using System.Collections.Immutable;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using Emg.Core;

namespace EmgTachiePlugin.Editors;

/// <summary>
/// .emg のレイヤーをサムネイル付きで選ぶエディタ本体。
///
/// XAML を使わずコードで組んでいるのは、行数（パーツ数・母音数）が読み込む .emg によって
/// 変わるうえ、3つのモードで見た目を共有したいため。
/// </summary>
public sealed class EmgLayerEditor : UserControl
{
    private static readonly (string Label, EmgMouthShape Shape)[] VowelSlots =
    {
        ("あ", EmgMouthShape.A),
        ("い", EmgMouthShape.I),
        ("う", EmgMouthShape.U),
        ("え", EmgMouthShape.E),
        ("お", EmgMouthShape.O),
        ("ん（閉じ）", EmgMouthShape.Silent),
    };

    // まばたきは「開いた状態→閉じた状態」の順に並べて使う（EmgAnimation.SelectByOpenness の前提）。
    // 保存時は位置ではなくキーで持つ（BlinkKeys と対応）。
    private static readonly string[] BlinkSlots = { "開いた状態", "半開き", "閉じた状態" };
    internal static readonly string[] BlinkKeys = { "Open", "Half", "Closed" };

    private readonly StackPanel rootPanel;
    private EmgLayerEditorMode mode;
    private EmgCharacterParameter? characterParameter;
    private object? propertyOwner;
    private PropertyInfo? propertyInfo;
    private bool isUpdatingUi;

    public EmgLayerEditor()
    {
        rootPanel = new StackPanel { Margin = new Thickness(0, 2, 0, 2) };
        Content = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = 320,
            Content = rootPanel,
        };
    }

    public void Initialize(
        EmgLayerEditorMode editorMode, EmgCharacterParameter? character, object owner, PropertyInfo property)
    {
        mode = editorMode;
        characterParameter = character;
        propertyOwner = owner;
        propertyInfo = property;
        Rebuild();
    }

    public void Cleanup()
    {
        rootPanel.Children.Clear();
        characterParameter = null;
        propertyOwner = null;
        propertyInfo = null;
    }

    private void Rebuild()
    {
        isUpdatingUi = true;
        try
        {
            rootPanel.Children.Clear();

            var emgPath = characterParameter?.EmgFilePath;
            var data = EmgLayerCatalog.GetData(emgPath);
            if (data is null)
            {
                rootPanel.Children.Add(new TextBlock
                {
                    Text = "先にキャラクター設定で .emg ファイルを選択してください。",
                    TextWrapping = TextWrapping.Wrap,
                    Opacity = 0.7,
                    Margin = new Thickness(4),
                });
                return;
            }

            var allChoices = EmgLayerCatalog.GetChoices(emgPath);
            var current = GetCurrentValue();

            switch (mode)
            {
                case EmgLayerEditorMode.Display:
                    BuildDisplayRows(data, allChoices, current);
                    break;
                case EmgLayerEditorMode.Blink:
                    BuildSlotRows(BlinkSlots, allChoices, current, isVowel: false);
                    break;
                case EmgLayerEditorMode.Vowel:
                    BuildSlotRows(VowelSlots.Select(v => v.Label).ToArray(), allChoices, current, isVowel: true);
                    break;
            }
        }
        finally
        {
            isUpdatingUi = false;
        }
    }

    /// <summary>パーツごとに1行（「変更しない」＋そのパーツのレイヤー）。</summary>
    private void BuildDisplayRows(EmgData data, IReadOnlyList<EmgLayerChoice> allChoices, ImmutableList<string> current)
    {
        var switchParts = data.Parts.Where(p => p.Type == "switch").ToList();
        if (switchParts.Count == 0)
        {
            rootPanel.Children.Add(new TextBlock
            {
                Text = "この .emg には切り替え可能なパーツ（type: switch）がありません。",
                TextWrapping = TextWrapping.Wrap,
                Opacity = 0.7,
                Margin = new Thickness(4),
            });
            return;
        }

        foreach (var part in switchParts)
        {
            var choices = new List<EmgLayerChoice>
            {
                new() { PartID = part.PartID, TextureID = "（変更しない）", IsNone = true },
            };
            choices.AddRange(allChoices.Where(c => c.PartID == part.PartID));

            string? selectedTexture = FindValue(current, part.PartID);
            var selected = choices.FirstOrDefault(c => !c.IsNone && c.TextureID == selectedTexture) ?? choices[0];

            rootPanel.Children.Add(CreateRow(part.PartID, choices, selected, chosen =>
            {
                var next = RemoveKey(GetCurrentValue(), part.PartID);
                if (!chosen.IsNone) next = next.Add($"{part.PartID}={chosen.TextureID}");
                SetCurrentValue(next);
            }));
        }
    }

    /// <summary>
    /// まばたき／母音のように「スロットが固定」のモード。
    /// 選択肢は全 switch パーツのレイヤーから選べるようにしてある。目・口パーツが自動検出できない
    /// .emg（textureID が数字だけ等）でも、ユーザーがレイヤーを選べばそのパーツが目・口として扱われる
    /// （EmgAnimation.ApplyOverrideRoles が選ばれたレイヤーの所属パーツを役割として採用する）。
    /// </summary>
    private void BuildSlotRows(
        string[] slotLabels, IReadOnlyList<EmgLayerChoice> allChoices, ImmutableList<string> current, bool isVowel)
    {
        for (int i = 0; i < slotLabels.Length; i++)
        {
            int slotIndex = i;
            var choices = new List<EmgLayerChoice>
            {
                new() { PartID = "", TextureID = "（なし）", IsNone = true },
            };
            choices.AddRange(allChoices);

            // "キー=パーツID<TAB>textureID" 形式で保存する。
            // textureID だけを保存していたときは、himari3.emg のように複数パーツが同じ
            // textureID（"9" が 口 と 目、"1"〜"5" が 眉・口・目）を持つファイルで、
            // 復元時に最初に見つかった別パーツのレイヤーが選ばれてしまい、
            // 「眉がまばたきの対象になる」という不具合になっていた。
            string key = isVowel ? VowelSlots[slotIndex].Shape.ToString() : BlinkKeys[slotIndex];
            var (selectedPart, selectedTexture) = ParseValue(FindValue(current, key));
            var selected = choices.FirstOrDefault(c =>
                !c.IsNone && c.TextureID == selectedTexture &&
                (selectedPart is null || c.PartID == selectedPart)) ?? choices[0];

            rootPanel.Children.Add(CreateRow(slotLabels[slotIndex], choices, selected, chosen =>
            {
                var next = RemoveKey(GetCurrentValue(), key);
                if (!chosen.IsNone) next = next.Add($"{key}={chosen.PartID}\t{chosen.TextureID}");
                SetCurrentValue(next);
            }));
        }
    }

    private FrameworkElement CreateRow(
        string label, List<EmgLayerChoice> choices, EmgLayerChoice selected, Action<EmgLayerChoice> onChanged)
    {
        var grid = new Grid { Margin = new Thickness(2) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var labelBlock = new TextBlock
        {
            Text = label,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(2, 0, 6, 0),
        };
        labelBlock.SetValue(Grid.ColumnProperty, 0);
        grid.Children.Add(labelBlock);

        var combo = new ComboBox
        {
            ItemsSource = choices,
            SelectedItem = selected,
            ItemTemplate = CreateItemTemplate(),
            MaxDropDownHeight = 400,
        };
        combo.SetValue(Grid.ColumnProperty, 1);
        combo.SelectionChanged += (_, _) =>
        {
            if (isUpdatingUi) return;
            if (combo.SelectedItem is EmgLayerChoice chosen) onChanged(chosen);
        };
        grid.Children.Add(combo);

        return grid;
    }

    /// <summary>サムネイル＋ラベルの行テンプレート。</summary>
    private static DataTemplate CreateItemTemplate()
    {
        var panel = new FrameworkElementFactory(typeof(StackPanel));
        panel.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);

        var image = new FrameworkElementFactory(typeof(Image));
        image.SetBinding(Image.SourceProperty, new Binding(nameof(EmgLayerChoice.Thumbnail)));
        image.SetValue(HeightProperty, 28.0);
        image.SetValue(MaxWidthProperty, 64.0);
        image.SetValue(MarginProperty, new Thickness(0, 0, 6, 0));
        image.SetValue(Image.StretchProperty, Stretch.Uniform);
        panel.AppendChild(image);

        var text = new FrameworkElementFactory(typeof(TextBlock));
        text.SetBinding(TextBlock.TextProperty, new Binding(nameof(EmgLayerChoice.Display)));
        text.SetValue(VerticalAlignmentProperty, VerticalAlignment.Center);
        panel.AppendChild(text);

        return new DataTemplate { VisualTree = panel };
    }

    // ---- プロパティ値（ImmutableList<string>）の読み書き ----

    private ImmutableList<string> GetCurrentValue()
    {
        if (propertyInfo is null || propertyOwner is null) return ImmutableList<string>.Empty;
        return propertyInfo.GetValue(propertyOwner) as ImmutableList<string> ?? ImmutableList<string>.Empty;
    }

    private void SetCurrentValue(ImmutableList<string> value)
    {
        if (propertyInfo is null || propertyOwner is null) return;
        propertyInfo.SetValue(propertyOwner, value);
    }

    /// <summary>"key=value" 形式のリストから value を引く。</summary>
    private static string? FindValue(ImmutableList<string> list, string key)
    {
        string prefix = key + "=";
        var hit = list.FirstOrDefault(v => v.StartsWith(prefix, StringComparison.Ordinal));
        return hit?.Substring(prefix.Length);
    }

    /// <summary>
    /// 値を "パーツID&lt;TAB&gt;textureID" として分解する。
    /// TAB が無いものは textureID だけを保存していた頃の古い設定として扱う。
    /// </summary>
    internal static (string? PartID, string? TextureID) ParseValue(string? value)
    {
        if (string.IsNullOrEmpty(value)) return (null, null);
        int tab = value.IndexOf('\t');
        return tab < 0 ? (null, value) : (value[..tab], value[(tab + 1)..]);
    }

    private static ImmutableList<string> RemoveKey(ImmutableList<string> list, string key)
    {
        string prefix = key + "=";
        return ImmutableList.CreateRange(list.Where(v => !v.StartsWith(prefix, StringComparison.Ordinal)));
    }
}
