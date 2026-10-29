import XCTest

@testable import SnipToss

/// The JSON writer every settings write goes through
final class JSONTextTests: XCTestCase {
    func testStringsAreEscapedButSlashesAndNonASCIIAreNot() {
        let out = JSONText.document(["s": "a\"b\\c\n\u{01}é/"] as [String: Any])
        XCTAssertEqual(out, "{\n  \"s\": \"a\\\"b\\\\c\\n\\u0001é/\"\n}\n")
    }

    func testEmptyContainersAreWrittenOnOneLine() {
        var object = OrderedJSONObject()
        object.set("a", [Any]())
        object.set("o", [String: Any]())
        XCTAssertEqual(JSONText.document(object), "{\n  \"a\": [],\n  \"o\": {}\n}\n")
    }

    func testBooleansAndNumbersKeepTheirKind() {
        let out = JSONText.document(["b": true, "i": 3, "d": 1.5, "w": 2.0, "n": NSNull()] as [String: Any])
        XCTAssertEqual(out, "{\n  \"b\": true,\n  \"d\": 1.5,\n  \"i\": 3,\n  \"n\": null,\n  \"w\": 2\n}\n")
    }

    func testOrderedObjectsKeepTheirOrderAndPlainDictionariesAreSorted() {
        var object = OrderedJSONObject()
        object.set("z", 1)
        object.set("a", ["y": 1, "b": 2] as [String: Any])
        XCTAssertEqual(JSONText.document(object), "{\n  \"z\": 1,\n  \"a\": {\n    \"b\": 2,\n    \"y\": 1\n  }\n}\n")
    }

    func testTheOutputIsValidJSONThatReadsBackAsTheSameValues() throws {
        let value: [String: Any] = [
            "list": [1, "two", NSNull(), true, ["k": [Any]()] as [String: Any]] as [Any],
            "text": "caf\u{E9} \u{1F600} \t",
            "big": Int64(12_345_678_901),
            "neg": -2.5,
        ]
        let data = Data(JSONText.document(value).utf8)
        let back = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(back["text"] as? String, "caf\u{E9} \u{1F600} \t")
        XCTAssertEqual(back["big"] as? Int64, 12_345_678_901)
        XCTAssertEqual(back["neg"] as? Double, -2.5)
        let list = try XCTUnwrap(back["list"] as? [Any])
        XCTAssertEqual(list.count, 5)
        XCTAssertEqual(jsonBool(list[3]), true)
        XCTAssertNil(jsonBool(list[0]))
    }

    func testOnlyARealBooleanIsABoolean() {
        XCTAssertEqual(jsonBool(true), true)
        XCTAssertEqual(jsonBool(false), false)
        XCTAssertNil(jsonBool(1))
        XCTAssertNil(jsonBool(0))
        XCTAssertNil(jsonBool("true"))
        XCTAssertNil(jsonBool(NSNull()))
        XCTAssertNil(jsonBool(nil))
        XCTAssertEqual(jsonBool(NSNumber(value: true)), true)
        XCTAssertNil(jsonBool(NSNumber(value: 1)))
    }
}
