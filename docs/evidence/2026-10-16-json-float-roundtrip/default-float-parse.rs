fn main() {
    for bits in [0x4057733333333334_u64, 0x4046e66666666667, 0x4043666666666667] {
        let original = f64::from_bits(bits);
        let json = serde_json::to_string(&original).unwrap();
        let parsed: f64 = serde_json::from_str(&json).unwrap();
        println!("{json}: {bits:016x} -> {:016x}; exact={}", parsed.to_bits(), parsed.to_bits() == bits);
    }
}
