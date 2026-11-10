package com.physicsos.student.navigation

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.physicsos.student.R
import com.physicsos.student.core.AppGraph
import com.physicsos.student.core.AuthState
import com.physicsos.student.feature.account.AccountScreen
import com.physicsos.student.feature.auth.AuthScreen
import com.physicsos.student.feature.chat.ChatScreen
import com.physicsos.student.feature.classes.ClassesScreen
import com.physicsos.student.feature.document.DocumentScreen
import com.physicsos.student.feature.experiments.ExperimentListScreen
import com.physicsos.student.feature.experiments.ExperimentScreen
import com.physicsos.student.feature.experiments.importScene
import com.physicsos.student.feature.home.HomeScreen
import com.physicsos.student.feature.library.LibraryScreen
import com.physicsos.student.feature.records.RecordsScreen
import com.physicsos.student.ui.components.ErrorState
import com.physicsos.student.ui.components.LoadingState
import com.physicsos.student.ui.theme.PhysicsTheme
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val DOCUMENT_KIND = "navigation-documents"
private const val CHAT_DRAFT_KIND = "navigation-chat-drafts"
private const val MAX_DOCUMENT_CHARACTERS = 1_000_000

private data class PrimaryDestination(
    val route: String,
    @StringRes val label: Int,
    @DrawableRes val icon: Int,
)

private val primaryDestinations = listOf(
    PrimaryDestination(Destinations.HOME, R.string.nav_home, R.drawable.ic_nav_home),
    PrimaryDestination(Destinations.EXPERIMENTS, R.string.nav_experiments, R.drawable.ic_nav_experiments),
    PrimaryDestination("chat", R.string.nav_chat, R.drawable.ic_nav_chat),
    PrimaryDestination(Destinations.RECORDS, R.string.nav_records, R.drawable.ic_nav_records),
    PrimaryDestination(Destinations.ACCOUNT, R.string.nav_account, R.drawable.ic_nav_account),
)

@Composable
fun PhysicsApp(graph: AppGraph) {
    val authState by graph.auth.state.collectAsStateWithLifecycle()
    val theme by graph.settings.theme.collectAsStateWithLifecycle(initialValue = "system")
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val signedInUser = (authState as? AuthState.SignedIn)?.user
    val owner = signedInUser?.userKey ?: "guest"
    PhysicsTheme(darkTheme = dark) {
        // Re-registering the same username must not revive the previous account's navigation state.
        key(signedInUser?.userId ?: "guest") { StudentNavigator(graph, authState, owner) }
    }
}

@Composable
private fun StudentNavigator(graph: AppGraph, authState: AuthState, owner: String) {
    val context = LocalContext.current
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val currentEntry by nav.currentBackStackEntryAsState()
    val currentRoute = currentEntry?.destination?.route?.substringBefore('?')
    val authError by graph.auth.lastError.collectAsStateWithLifecycle()

    fun navigate(route: String) {
        nav.navigate(route) { launchSingleTop = true }
    }
    fun openPolicy(policy: String) {
        if (policy in setOf("privacy", "terms", "sdks")) navigate(Destinations.policy(policy))
    }
    fun reportFailure() {
        scope.launch { snackbar.showSnackbar(context.getString(R.string.navigation_operation_failed)) }
    }
    fun openDocument(title: String, markdown: String) {
        scope.launch {
            try {
                require(markdown.length <= MAX_DOCUMENT_CHARACTERS)
                val id = UUID.randomUUID().toString()
                graph.store.put(DOCUMENT_KIND, owner, id, buildJsonObject {
                    put("title", title.take(300))
                    put("markdown", markdown)
                })
                navigate(Destinations.document(id))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                reportFailure()
            }
        }
    }
    fun openChat(sessionId: String?, prompt: String?) {
        scope.launch {
            try {
                val draftId = prompt?.takeIf { it.isNotBlank() }?.let { text ->
                    require(text.length <= MAX_DOCUMENT_CHARACTERS)
                    val id = UUID.randomUUID().toString()
                    graph.store.put(CHAT_DRAFT_KIND, owner, id, buildJsonObject { put("text", text) })
                    id
                }
                navigate(Destinations.chat(sessionId, draftId))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                reportFailure()
            }
        }
    }
    fun openExperiment(templateId: String?, scene: JsonObject?) {
        scope.launch {
            try {
                val localSceneId = scene?.let { importScene(graph, it) }
                navigate(Destinations.experiment(templateId, localSceneId))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                reportFailure()
            }
        }
    }
    fun openExternal(url: String) {
        val parsed = runCatching { URI(url) }.getOrNull()
        if (parsed == null || parsed.scheme !in setOf("https", "http") ||
            parsed.host.isNullOrBlank() || parsed.rawUserInfo != null
        ) {
            scope.launch { snackbar.showSnackbar(context.getString(R.string.navigation_external_invalid)) }
            return
        }
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(parsed.toASCIIString())).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            })
        } catch (_: ActivityNotFoundException) {
            scope.launch { snackbar.showSnackbar(context.getString(R.string.file_open_failed)) }
        } catch (_: SecurityException) {
            scope.launch { snackbar.showSnackbar(context.getString(R.string.file_open_failed)) }
        }
    }
    fun goHome() {
        nav.navigate(Destinations.HOME) {
            popUpTo(nav.graph.id) { inclusive = true }
            launchSingleTop = true
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        val showNavigation = currentRoute in primaryDestinations.map { it.route }
        Row(Modifier.fillMaxSize()) {
            if (wide && showNavigation) {
                NavigationRail {
                    primaryDestinations.forEach { destination ->
                        NavigationRailItem(
                            selected = currentRoute == destination.route,
                            onClick = { navigate(destination.route) },
                            icon = { Icon(painterResource(destination.icon), contentDescription = null) },
                            label = { Text(stringResource(destination.label)) },
                            modifier = Modifier.testTag("nav_${destination.route}"),
                        )
                    }
                }
            }
            Scaffold(
                modifier = Modifier.weight(1f).fillMaxSize(),
                snackbarHost = { SnackbarHost(snackbar) },
                bottomBar = {
                    if (!wide && showNavigation) {
                        NavigationBar {
                            primaryDestinations.forEach { destination ->
                                NavigationBarItem(
                                    selected = currentRoute == destination.route,
                                    onClick = { navigate(destination.route) },
                                    icon = { Icon(painterResource(destination.icon), contentDescription = null) },
                                    label = { Text(stringResource(destination.label)) },
                                    modifier = Modifier.testTag("nav_${destination.route}"),
                                )
                            }
                        }
                    }
                },
            ) { padding ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    if (authState is AuthState.SignedIn &&
                        authError?.code == "reauthentication_required" && currentRoute != Destinations.AUTH
                    ) {
                        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text(
                                stringResource(R.string.navigation_reauthenticate),
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(onClick = { navigate(Destinations.AUTH) }) {
                                Text(stringResource(R.string.navigation_sign_in))
                            }
                        }
                    }
                    NavHost(navController = nav, startDestination = Destinations.HOME, modifier = Modifier.weight(1f)) {
                        composable(Destinations.HOME) {
                            HomeScreen(
                                graph = graph,
                                onOpenChat = ::openChat,
                                onOpenExperiments = { navigate(Destinations.EXPERIMENTS) },
                                onOpenLibrary = { navigate(Destinations.LIBRARY) },
                                onOpenClasses = { navigate(Destinations.classes()) },
                                onOpenRecords = { navigate(Destinations.RECORDS) },
                                onOpenAccount = { navigate(Destinations.ACCOUNT) },
                                onOpenDocument = ::openDocument,
                            )
                        }
                        composable(Destinations.EXPERIMENTS) {
                            ExperimentListScreen(graph, onOpenExperiment = { templateId, sceneId ->
                                navigate(Destinations.experiment(templateId, sceneId))
                            })
                        }
                        composable(
                            Destinations.EXPERIMENT,
                            arguments = listOf(optionalString("templateId"), optionalString("sceneId")),
                        ) { entry ->
                            ExperimentScreen(
                                graph = graph,
                                templateId = entry.arguments?.getString("templateId"),
                                sceneId = entry.arguments?.getString("sceneId"),
                                onBack = { nav.popBackStack() },
                                onOpenDocument = ::openDocument,
                            )
                        }
                        composable(
                            Destinations.CHAT,
                            arguments = listOf(optionalString("sessionId"), optionalString("draftId")),
                        ) { entry ->
                            AccountRequired(graph, authState, ::openPolicy, ::goHome) {
                                ChatDestination(
                                    graph = graph,
                                    owner = owner,
                                    sessionId = entry.arguments?.getString("sessionId"),
                                    draftId = entry.arguments?.getString("draftId"),
                                    onOpenExperiment = ::openExperiment,
                                    onOpenDocument = ::openDocument,
                                    onBack = { nav.popBackStack() },
                                )
                            }
                        }
                        composable(Destinations.RECORDS) {
                            AccountRequired(graph, authState, ::openPolicy, ::goHome) {
                                RecordsScreen(
                                    graph = graph,
                                    onOpenChat = ::openChat,
                                    onOpenExperiment = ::openExperiment,
                                    onOpenSavedExperiment = { sceneId ->
                                        navigate(Destinations.experiment(sceneId = sceneId))
                                    },
                                    onOpenDocument = ::openDocument,
                                    onBack = { nav.popBackStack() },
                                )
                            }
                        }
                        composable(Destinations.ACCOUNT) {
                            AccountRequired(graph, authState, ::openPolicy, ::goHome) {
                                AccountScreen(graph, onSignedOut = ::goHome, onOpenPolicy = ::openPolicy,
                                    onBack = { nav.popBackStack() })
                            }
                        }
                        composable(Destinations.AUTH) {
                            AuthScreen(graph, onAuthenticated = ::goHome, onOpenPolicy = ::openPolicy)
                        }
                        composable(Destinations.LIBRARY) {
                            LibraryScreen(
                                graph = graph,
                                onOpenExperiment = { openExperiment(it, null) },
                                onOpenChat = { openChat(null, it) },
                                onOpenDocument = ::openDocument,
                                onOpenExternal = ::openExternal,
                                onBack = { nav.popBackStack() },
                            )
                        }
                        composable(
                            Destinations.CLASSES,
                            arguments = listOf(optionalString("classId"), optionalString("assignmentId")),
                        ) { entry ->
                            AccountRequired(graph, authState, ::openPolicy, ::goHome) {
                                ClassesScreen(
                                    graph = graph,
                                    classId = entry.arguments?.getString("classId"),
                                    assignmentId = entry.arguments?.getString("assignmentId"),
                                    onOpenClass = { navigate(Destinations.classes(it)) },
                                    onOpenAssignment = { classId, assignmentId ->
                                        navigate(Destinations.classes(classId, assignmentId))
                                    },
                                    onOpenExperiment = ::openExperiment,
                                    onOpenDocument = ::openDocument,
                                    onBack = { nav.popBackStack() },
                                )
                            }
                        }
                        composable(Destinations.DOCUMENT, arguments = listOf(navArgument("documentId") {
                            type = NavType.StringType
                        })) { entry ->
                            StoredDocumentDestination(graph, owner, entry.arguments?.getString("documentId"),
                                onBack = { nav.popBackStack() })
                        }
                        composable(Destinations.POLICY, arguments = listOf(navArgument("policy") {
                            type = NavType.StringType
                        })) { entry ->
                            PolicyDestination(graph, entry.arguments?.getString("policy"),
                                onBack = { nav.popBackStack() })
                        }
                    }
                }
            }
        }
    }
}

private fun optionalString(name: String) = navArgument(name) {
    type = NavType.StringType
    nullable = true
    defaultValue = null
}

@Composable
private fun AccountRequired(
    graph: AppGraph,
    state: AuthState,
    onOpenPolicy: (String) -> Unit,
    onAuthenticated: () -> Unit,
    content: @Composable () -> Unit,
) {
    when (state) {
        AuthState.Restoring -> LoadingState()
        AuthState.SignedOut -> AuthScreen(graph, onAuthenticated, onOpenPolicy)
        is AuthState.SignedIn -> content()
    }
}

@Composable
private fun ChatDestination(
    graph: AppGraph,
    owner: String,
    sessionId: String?,
    draftId: String?,
    onOpenExperiment: (String?, JsonObject?) -> Unit,
    onOpenDocument: (String, String) -> Unit,
    onBack: () -> Unit,
) {
    var text by remember(draftId, owner) { mutableStateOf<String?>(null) }
    var loaded by remember(draftId, owner) { mutableStateOf(draftId == null) }
    var failed by remember(draftId, owner) { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(draftId, owner, retry) {
        if (draftId == null) return@LaunchedEffect
        failed = false
        try {
            val record = graph.store.get(CHAT_DRAFT_KIND, owner, draftId)
            text = (record?.payload?.get("text") as? JsonPrimitive)?.content
            require(text != null)
            loaded = true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    when {
        failed -> ErrorState(stringResource(R.string.navigation_document_missing), { retry++ })
        !loaded -> LoadingState()
        else -> ChatScreen(graph, sessionId, text, onOpenExperiment, onOpenDocument, onBack)
    }
}

@Composable
private fun StoredDocumentDestination(
    graph: AppGraph,
    owner: String,
    documentId: String?,
    onBack: () -> Unit,
) {
    var document by remember(documentId, owner) { mutableStateOf<Pair<String, String>?>(null) }
    var failed by remember(documentId, owner) { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(documentId, owner, retry) {
        failed = false
        try {
            require(documentId != null)
            val payload = requireNotNull(graph.store.get(DOCUMENT_KIND, owner, documentId)).payload
            val title = requireNotNull(payload["title"] as? JsonPrimitive).content
            val markdown = requireNotNull(payload["markdown"] as? JsonPrimitive).content
            document = title to markdown
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    when {
        failed -> ErrorState(stringResource(R.string.navigation_document_missing), { retry++ })
        document == null -> LoadingState()
        else -> document?.let { (title, markdown) -> DocumentScreen(graph, title, markdown, onBack) }
    }
}

@Composable
private fun PolicyDestination(graph: AppGraph, policy: String?, onBack: () -> Unit) {
    val context = LocalContext.current
    val title = when (policy) {
        "privacy" -> stringResource(R.string.navigation_privacy_title)
        "terms" -> stringResource(R.string.navigation_terms_title)
        "sdks" -> stringResource(R.string.navigation_sdks_title)
        else -> stringResource(R.string.navigation_document_title)
    }
    var markdown by remember(policy) { mutableStateOf<String?>(null) }
    var failed by remember(policy) { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(policy, retry) {
        failed = false
        try {
            require(policy in setOf("privacy", "terms", "sdks"))
            markdown = withContext(Dispatchers.IO) {
                context.assets.open("legal/$policy.md").bufferedReader(Charsets.UTF_8).use { it.readText() }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    when {
        failed -> ErrorState(stringResource(R.string.state_error_message), { retry++ })
        markdown == null -> LoadingState()
        else -> DocumentScreen(graph, title, requireNotNull(markdown), onBack)
    }
}
