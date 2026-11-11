package com.physicsos.student.core

import android.content.Context
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomAccountIsolationTest {
    private lateinit var database: CoreDatabase
    private lateinit var store: RoomLocalStore
    private lateinit var owners: OwnerGate
    private val fence = RequestFence()

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, CoreDatabase::class.java)
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(Dispatchers.IO)
            .build()
        owners = OwnerGate(fence)
        store = RoomLocalStore({ database }, owners, PrivateFiles(listOf(File(context.cacheDir, "isolation-test"))),
            OriginPolicy("https://candidate.example", "https://candidate.example/physicsos/mobile/v1/"))
    }

    @After
    fun teardown() { database.close() }

    @Test
    fun unchangedAccountInstanceRetainsItsRecords() = runBlocking {
        val user = user("instance-one")
        activate(user)
        store.put("attempts", user.userKey, "attempt", buildJsonObject { put("answer", "saved") })
        activate(user)
        assertEquals("saved", store.get("attempts", user.userKey, "attempt")?.payload?.optionalString("answer"))
    }

    @Test
    fun reRegisteredUsernameDoesNotRecoverOldAccountRecordsOrOutbox() = runBlocking {
        val previous = user("instance-one")
        activate(previous)
        store.put("attempts", previous.userKey, "attempt", buildJsonObject { put("answer", "old account") })
        store.put("attempts", "guest", "offline", buildJsonObject { put("answer", "guest") })
        database.records().putOutbox(OutboxEntity("operation", previous.userKey, "PUT", "learning/attempts/attempt", "{}",
            "operation-key", OutboxState.PENDING.name, 0, 1, 1, 1))
        activate(user("instance-two"))
        assertNull(store.get("attempts", previous.userKey, "attempt"))
        assertNull(database.records().outbox(previous.userKey, "operation"))
        assertEquals("guest", store.get("attempts", "guest", "offline")?.payload?.optionalString("answer"))
    }

    @Test
    fun legacyUntaggedRecordsAreNotAdoptedByANewLogin() = runBlocking {
        val next = user("instance-new")
        database.records().putItem(StoredEntity(next.userKey, "attempts", "legacy", "{}", 1))
        activate(next)
        assertNull(store.get("attempts", next.userKey, "legacy"))
    }

    private suspend fun activate(user: MobileUser) {
        val stamp = AccountStamp(user.userKey, fence.advance(), user.userId)
        owners.replace(stamp) { store.activateOwner(user) }
    }

    private fun user(id: String) = MobileUser("school:student", "school", "student", "Student", "student", id)
}
