"""A tiny random-weight Whisper in CTranslate2 format with a Whisper-compatible
tokenizer: runs faster-whisper end to end (audio, VAD, decoding, word
timestamps) without downloading a model. The words it outputs are noise."""

from __future__ import annotations

from pathlib import Path

# Whisper's language order (99 languages: the 80-mel vocabulary of tiny…large-v2)
LANGS = (
    "en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la "
    "mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be "
    "tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su"
).split()


def build_fake_whisper(out: Path, d: int = 64, heads: int = 2, ffn: int = 128, layers: int = 2) -> Path:
    import numpy as np
    from ctranslate2.specs import whisper_spec
    from tokenizers import AddedToken, Tokenizer, decoders, models, pre_tokenizers

    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)

    def rnd(*shape):
        return (rng.standard_normal(shape) * 0.05).astype(np.float32)

    regular = sorted(pre_tokenizers.ByteLevel.alphabet())
    regular += [f"Ġw{i}" for i in range(50257 - len(regular))]
    special = ["<|endoftext|>", "<|startoftranscript|>", *(f"<|{c}|>" for c in LANGS), "<|translate|>",
               "<|transcribe|>", "<|startoflm|>", "<|startofprev|>", "<|nospeech|>", "<|notimestamps|>"]
    stamps = ["<|%.2f|>" % (i * 0.02) for i in range(1501)]
    tokens = regular + special + stamps
    ids = {t: i for i, t in enumerate(tokens)}

    def ln(s):
        s.gamma, s.beta = np.ones(d, np.float32), np.zeros(d, np.float32)

    def lin(s, n_out, n_in):
        s.weight, s.bias = rnd(n_out, n_in), np.zeros(n_out, np.float32)

    def ffn_(s):
        ln(s.layer_norm)
        lin(s.linear_0, ffn, d)
        lin(s.linear_1, d, ffn)

    spec = whisper_spec.WhisperSpec(layers, heads, layers, heads)
    enc = spec.encoder
    enc.conv1.weight, enc.conv1.bias = rnd(d, 80, 3), np.zeros(d, np.float32)
    enc.conv2.weight, enc.conv2.bias = rnd(d, d, 3), np.zeros(d, np.float32)
    enc.position_encodings.encodings = rnd(1500, d)
    for layer in enc.layer:
        ln(layer.self_attention.layer_norm)
        lin(layer.self_attention.linear[0], 3 * d, d)
        lin(layer.self_attention.linear[1], d, d)
        ffn_(layer.ffn)
    ln(enc.layer_norm)
    dec = spec.decoder
    dec.embeddings.weight = rnd(len(tokens), d)
    dec.position_encodings.encodings = rnd(448, d)
    for layer in dec.layer:
        ln(layer.self_attention.layer_norm)
        lin(layer.self_attention.linear[0], 3 * d, d)
        lin(layer.self_attention.linear[1], d, d)
        ln(layer.attention.layer_norm)
        lin(layer.attention.linear[0], d, d)
        lin(layer.attention.linear[1], 2 * d, d)
        lin(layer.attention.linear[2], d, d)
        ffn_(layer.ffn)
    ln(dec.layer_norm)
    dec.projection.weight = dec.embeddings.weight
    # CTranslate2 treats a vocabulary that has an empty token as multilingual
    spec.register_vocabulary(tokens[:50000] + [""] + tokens[50001:])
    spec.config.suppress_ids = [ids[t] for t in ("<|translate|>", "<|transcribe|>", "<|startoflm|>",
                                                 "<|startofprev|>", "<|startoftranscript|>")]
    spec.config.suppress_ids_begin = [ids["<|endoftext|>"]]
    spec.config.lang_ids = [ids[f"<|{c}|>"] for c in LANGS]
    spec.config.alignment_heads = [(layers - 1, h) for h in range(heads)]
    spec.validate()
    spec.save(str(out))

    tok = Tokenizer(models.BPE(vocab={t: i for i, t in enumerate(regular)}, merges=[]))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.add_special_tokens([AddedToken(t, special=True) for t in special + stamps])
    tok.save(str(out / "tokenizer.json"))
    return out
