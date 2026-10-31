/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.client;

import com.readwise.client.DictionaryEntry;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 词典响应归一化单测（§4.4）。
 * 用例全部取自 Free Dictionary API 的真实数据形态：
 * read（英美双音频）、either（只有 IPA 无音频）、colour（只有澳洲音频、无 IPA）、
 * development（单条带 -us 音频）。
 */
class DictionaryEntryParserTest {

    private final DictionaryEntryParser parser = new DictionaryEntryParser(new JsonMapper());

    @Test
    void ukAndUsAudioShouldBeSplitByRegionSuffix() {
        String body = """
                [{"word":"read",
                  "phonetic":"/ɹiːd/",
                  "phonetics":[
                    {"text":"/ɹiːd/","audio":"https://api.dictionaryapi.dev/media/pronunciations/en/read-1-uk.mp3"},
                    {"text":"/rid/","audio":"https://api.dictionaryapi.dev/media/pronunciations/en/read-1-us.ogg"}
                  ],
                  "meanings":[{"partOfSpeech":"verb","definitions":[{"definition":"to read"}]}]
                }]
                """;

        Optional<DictionaryEntry> entry = parser.parse(body);
        assertThat(entry).isPresent();
        assertThat(entry.get().phoneticUk()).isEqualTo("/ɹiːd/");
        assertThat(entry.get().phoneticUs()).isEqualTo("/rid/");
        assertThat(entry.get().audioUkUrl()).endsWith("read-1-uk.mp3");
        assertThat(entry.get().audioUsUrl()).endsWith("read-1-us.ogg");
        assertThat(entry.get().hasAudio()).isTrue();
    }

    @Test
    void regionTaggedAudioShouldNotBeInventedForTheOtherRegion() {
        String body = """
                [{"word":"development",
                  "phonetic":"/dɪˈvɛləpmənt/",
                  "phonetics":[{"text":"/dɪˈvɛləpmənt/","audio":"https://api.dictionaryapi.dev/media/pronunciations/en/development-us.mp3"}],
                  "meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"The process of developing."}]}]
                }]
                """;

        DictionaryEntry entry = parser.parse(body).orElseThrow();
        // 顶层 phonetic 不带地域，两边共用；但音频只标了 -us，就不能编出一个英音音频
        assertThat(entry.phoneticUk()).isEqualTo("/dɪˈvɛləpmənt/");
        assertThat(entry.phoneticUs()).isEqualTo("/dɪˈvɛləpmənt/");
        assertThat(entry.audioUkUrl()).isNull();
        assertThat(entry.audioUsUrl()).endsWith("development-us.mp3");
    }

    @Test
    void regionTaggedIpaShouldNotBeMirroredIntoTheOtherRegion() {
        String body = """
                [{"word":"development",
                  "phonetics":[{"text":"/dɪˈvɛləpmənt/","audio":"https://api.dictionaryapi.dev/media/pronunciations/en/development-us.mp3"}],
                  "meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"The process of developing."}]}]
                }]
                """;

        DictionaryEntry entry = parser.parse(body).orElseThrow();
        // 没有中性音标可用时，已标 -us 的读音不跨区冒充英音（R7：不让学习者记错发音）
        assertThat(entry.phoneticUs()).isEqualTo("/dɪˈvɛləpmənt/");
        assertThat(entry.phoneticUk()).isNull();
    }

    @Test
    void neutralIpaWithoutRegionShouldFillBothSides() {
        String body = """
                [{"word":"either",
                  "phonetic":"/ˈaɪð.ə(ɹ)/",
                  "phonetics":[{"text":"/ˈaɪð.ə(ɹ)/","audio":""}],
                  "meanings":[{"partOfSpeech":"adverb","definitions":[{"definition":"at either side"}]}]
                }]
                """;

        DictionaryEntry entry = parser.parse(body).orElseThrow();
        assertThat(entry.phoneticUk()).isEqualTo("/ˈaɪð.ə(ɹ)/");
        assertThat(entry.phoneticUs()).isEqualTo("/ˈaɪð.ə(ɹ)/");
        // 无音频：交由前端 speechSynthesis 兜底
        assertThat(entry.hasAudio()).isFalse();
    }

    @Test
    void otherRegionAudioShouldNotImpersonateUkOrUs() {
        String body = """
                [{"word":"colour",
                  "phonetics":[{"audio":"https://api.dictionaryapi.dev/media/pronunciations/en/colour-au.mp3"}],
                  "meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"color"}]}]
                }]
                """;

        DictionaryEntry entry = parser.parse(body).orElseThrow();
        assertThat(entry.hasPhonetic()).isFalse();
        assertThat(entry.hasAudio()).isFalse();
    }

    @Test
    void glossesShouldBeCappedAtFiveItems() {
        StringBuilder definitions = new StringBuilder();
        for (int i = 0; i < 10; i++) {
            definitions.append("{\"definition\":\"def ").append(i).append("\"}");
            if (i < 9) {
                definitions.append(",");
            }
        }
        String body = """
                [{"word":"run",
                  "meanings":[{"partOfSpeech":"verb","definitions":[%s]}]
                }]
                """.formatted(definitions);

        DictionaryEntry entry = parser.parse(body).orElseThrow();
        // 像 run 这种长词条会拉回几十条释义，只保留最常用的前几条（§4.4 也控制下游 token 成本）
        assertThat(entry.glosses()).hasSize(5);
        assertThat(entry.glosses().get(0).englishDefinition()).isEqualTo("def 0");
        assertThat(entry.glosses().get(4).englishDefinition()).isEqualTo("def 4");
    }

    @Test
    void duplicateGlossesAcrossPartsOfSpeechShouldBeDropped() {
        String body = """
                [{"word":"book",
                  "meanings":[
                    {"partOfSpeech":"noun","definitions":[{"definition":"a set of pages"},{"definition":"a set of pages"}]},
                    {"partOfSpeech":"verb","definitions":[{"definition":"to reserve"},{"definition":"a set of pages"},{"definition":"to record"}]}
                  ]
                }]
                """;

        DictionaryEntry entry = parser.parse(body).orElseThrow();
        // 重复释义不占位，后面的有效释义顶上来；词性按所属 meaning 保留
        assertThat(entry.glosses())
                .extracting(DictionaryEntry.Gloss::englishDefinition, DictionaryEntry.Gloss::pos)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("a set of pages", "noun"),
                        org.assertj.core.groups.Tuple.tuple("to reserve", "verb"),
                        org.assertj.core.groups.Tuple.tuple("to record", "verb"));
    }

    @Test
    void notFoundAndMalformedBodiesShouldBeTreatedAsMiss() {
        assertThat(parser.parse("[]")).isEmpty();
        assertThat(parser.parse(null)).isEmpty();
        assertThat(parser.parse("")).isEmpty();
        assertThat(parser.parse("{\"title\":\"No Definitions Found\"}")).isEmpty();
        assertThat(parser.parse("not json at all")).isEmpty();
        // 有 word 但没有释义的词条同样视为未命中
        assertThat(parser.parse("[{\"word\":\"x\",\"meanings\":[]}]")).isEmpty();
    }
}
