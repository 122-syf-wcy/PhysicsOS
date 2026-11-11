package com.physicsos.student.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RichMessageLayoutTest {
    @Test fun completedParagraphIdentitiesAreStableWhileTheTailStreams() {
        val prefix = "## Newton’s law\n\nThe net force is $" + "F=ma$" + ".\n\n"
        val first = richMessageLayout(prefix + "For a mass")
        val second = richMessageLayout(prefix + "For a mass of 2 kg, the acceleration is")
        assertEquals(first.parts.take(2), second.parts.take(2))
        assertEquals(first.parts.last().index, second.parts.last().index)
        assertFalse(second.abbreviated)
    }

    @Test fun fencedCodeAndMultilineFormulasDoNotSplitAtBlankLines() {
        val source = "```text\nfirst\n\nsecond\n```\n\n$$\nx=1\n\ny=2\n$$\n\nAnswer"
        val layout = richMessageLayout(source)
        assertEquals(3, layout.parts.size)
        assertTrue(layout.parts[0].markdown.contains("first\n\nsecond"))
        assertTrue(layout.parts[1].markdown.contains("x=1\n\ny=2"))
    }

    @Test fun manyParagraphsKeepABoundedViewCountWithoutDiscardingTheirText() {
        val source = (1..200).joinToString("\n\n") { "Paragraph $it" }
        val layout = richMessageLayout(source)
        assertEquals(64, layout.parts.size)
        assertTrue(layout.parts.last().markdown.endsWith("Paragraph 200"))
        assertFalse(layout.abbreviated)
    }

    @Test fun unsupportedLongMessagesRetainAnExplicitFullDocumentPath() {
        val layout = richMessageLayout("x".repeat(50), maximum = 20)
        assertTrue(layout.abbreviated)
        assertEquals(20, layout.parts.single().markdown.length)
    }

    @Test fun commonMathDelimitersAreAdaptedWithoutDeletingTheFormula() {
        val delimiters = "$$"
        assertEquals("The force is ${delimiters}F=ma${delimiters}.", nativeMathMarkdown("The force is $" + "F=ma$" + "."))
        assertEquals("${delimiters}E=mc^2$delimiters", nativeMathMarkdown("\\(E=mc^2\\)"))
        assertEquals("${delimiters}\nx = \\frac{1}{2}at^2\n$delimiters", nativeMathMarkdown("\\[\nx = \\frac{1}{2}at^2\n\\]"))
        assertEquals("${delimiters}F=ma$delimiters", nativeMathMarkdown("${delimiters}F=ma$delimiters"))
    }

    @Test fun fileInclusionAndUnboundedFormulaNestingAreRejectedWithoutLosingTheSource() {
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { nativeMathMarkdown("\\\\includegraphics{private-file}") }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { nativeMathMarkdown("{".repeat(65)) }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { nativeMathMarkdown("$$" + "x".repeat(2_049) + "$$") }
        val currency = "It costs $" + "5 and $" + "10."
        assertEquals(currency, nativeMathMarkdown(currency))
    }

    @Test fun codeAndEscapedDollarTextAreNotRewrittenAsMath() {
        val source = "`$" + "literal$" + "`\n\n```\n$" + "keep$" + "\n```\n\n\\$5"
        assertEquals(source, nativeMathMarkdown(source))
    }
}
