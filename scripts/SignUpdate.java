import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.util.HexFormat;

/**
 * Signs update.json with the key the apk is signed with, so the installed app can tell a web update is ours
 * (UpdatePlugin.java checks it against the apk's own certificate). Run by the android workflow:
 *
 *   java scripts/SignUpdate.java keystore.p12 update.json update.json.sig
 *
 * The keystore password comes from ANDROID_KEYSTORE_PASSWORD. The key is used in memory and never written out.
 * Prints the SHA-256 of the signing certificate, which is public, so the build can compare it with the apk's.
 */
public class SignUpdate {
    public static void main(String[] args) throws Exception {
        char[] password = System.getenv("ANDROID_KEYSTORE_PASSWORD").toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = new FileInputStream(args[0])) {
            store.load(in, password);
        }
        PrivateKey key = (PrivateKey) store.getKey("mybrain", password);
        Certificate certificate = store.getCertificate("mybrain");
        // The same two choices UpdatePlugin.java makes from the certificate's key.
        String algorithm = "EC".equals(key.getAlgorithm()) ? "SHA256withECDSA" : "SHA256withRSA";
        byte[] text = Files.readAllBytes(Path.of(args[1]));

        Signature sign = Signature.getInstance(algorithm);
        sign.initSign(key);
        sign.update(text);
        byte[] signature = sign.sign();

        Signature check = Signature.getInstance(algorithm);
        check.initVerify(certificate.getPublicKey());
        check.update(text);
        if (!check.verify(signature)) throw new IllegalStateException("the signature does not check out");

        Files.write(Path.of(args[2]), signature);
        System.out.println(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
    }
}
