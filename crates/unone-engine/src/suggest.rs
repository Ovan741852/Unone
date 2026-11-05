//! Closest-name suggestions for diagnostics about a name that does not exist.

/// Lowercase words of an identifier: `isActionJustPressed` -> is, action, just, pressed.
pub(crate) fn words(name: &str) -> Vec<String> {
    let mut words = vec![String::new()];
    for c in name.chars() {
        if !c.is_alphanumeric() {
            words.push(String::new());
            continue;
        }
        if c.is_uppercase() && !words.last().is_some_and(String::is_empty) {
            words.push(String::new());
        }
        words.last_mut().expect("starts non-empty").extend(c.to_lowercase());
    }
    words.retain(|word| !word.is_empty());
    words
}

/// Edits between two names, ignoring case; swapping neighbours is one edit, so
/// `Rigth` is one edit from `Right`.
fn edits(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.to_lowercase().chars().collect();
    let b: Vec<char> = b.to_lowercase().chars().collect();
    let mut rows = vec![vec![0; b.len() + 1]; a.len() + 1];
    for (i, row) in rows.iter_mut().enumerate() { row[0] = i; }
    for j in 0..=b.len() { rows[0][j] = j; }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let replace = rows[i - 1][j - 1] + usize::from(a[i - 1] != b[j - 1]);
            rows[i][j] = replace.min(rows[i - 1][j] + 1).min(rows[i][j - 1] + 1);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                rows[i][j] = rows[i][j].min(rows[i - 2][j - 2] + 1);
            }
        }
    }
    rows[a.len()][b.len()]
}

/// Words shared by two names, a plural counting as its singular.
fn shared_words(a: &str, b: &str) -> usize {
    let stem = |word: String| match word.strip_suffix('s') {
        Some(stem) if stem.len() > 2 => stem.to_string(),
        _ => word,
    };
    let b: Vec<String> = words(b).into_iter().map(stem).collect();
    words(a).into_iter().map(stem).filter(|word| b.contains(word)).count()
}

/// The candidates most like `name`, best first: near-misses in spelling, then
/// names sharing the most words. Unrelated candidates are left out.
pub(crate) fn closest<'a>(name: &str, candidates: impl IntoIterator<Item = &'a str>, limit: usize) -> Vec<&'a str> {
    let near = 2.max(name.chars().count() / 3);
    let mut scored: Vec<(bool, std::cmp::Reverse<usize>, usize, &str)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            let distance = edits(name, candidate);
            let shared = shared_words(name, candidate);
            (distance <= near || shared > 0)
                .then_some((distance > 2, std::cmp::Reverse(shared), distance, candidate))
        })
        .collect();
    scored.sort();
    scored.into_iter().take(limit).map(|(.., candidate)| candidate).collect()
}

/// Candidates close enough to be a misspelling of `name`, closest first. For
/// names without a vocabulary of words, where sharing one says nothing.
#[cfg(feature = "dev-tools")]
pub(crate) fn misspellings<'a>(name: &str, candidates: impl IntoIterator<Item = &'a str>, limit: usize) -> Vec<&'a str> {
    let near = 2.max(name.chars().count() / 3);
    let mut scored: Vec<(usize, &str)> = candidates
        .into_iter()
        .map(|candidate| (edits(name, candidate), candidate))
        .filter(|(distance, _)| *distance <= near)
        .collect();
    scored.sort();
    scored.into_iter().take(limit).map(|(_, candidate)| candidate).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "dev-tools")]
    #[test]
    fn misspellings_ignore_names_that_only_share_a_word() {
        assert_eq!(misspellings("Rigth", ["Left", "Right", "Bright"], 2), ["Right", "Bright"]);
        assert!(misspellings("FrontLoad", ["FrontSoundVolume", "ChatNewer"], 2).is_empty());
    }

    #[test]
    fn near_misses_rank_before_shared_words_and_unrelated_names_drop_out() {
        let keys = ["Left", "Right", "Up", "Down", "Space", "R"];
        assert_eq!(closest("Rigth", keys, 3), ["Right"]);
        assert_eq!(closest("space", keys, 3), ["Space"]);
        assert!(closest("StartCurrentLevel", keys, 3).is_empty());
        let input = ["isDown", "isPointerDown", "wasPressed", "wasReleased", "hasPressedActions", "getPointerPosition"];
        assert_eq!(closest("isDwon", input, 2), ["isDown", "isPointerDown"]);
        assert!(closest("isActionJustPressed", input, 3).contains(&"wasPressed"));
    }

    #[test]
    fn words_split_identifiers_for_a_search_phrase() {
        assert_eq!(words("isActionJustPressed"), ["is", "action", "just", "pressed"]);
        assert_eq!(words("physics3d"), ["physics3d"]);
        assert_eq!(words("set_position"), ["set", "position"]);
    }
}
