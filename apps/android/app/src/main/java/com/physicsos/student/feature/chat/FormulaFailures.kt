package com.physicsos.student.feature.chat

/** Bounded error state never evicts old failures and repeatedly resubmits the same bad formula. */
internal data class FormulaFailures(val expressions: Set<String> = emptySet(), val overflow: Boolean = false) {
    fun record(formula: String): FormulaFailures {
        val identity = formula.replace('\n', ' ').trim()
        if (overflow || identity in expressions) return this
        return if (expressions.size >= 64) copy(overflow = true) else copy(expressions = expressions + identity)
    }

    fun affects(formulas: Set<String>): Boolean = overflow || formulas.any(expressions::contains)
}
