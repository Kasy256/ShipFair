import { type Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

let io: Promise<NodeIO> | undefined;

/** glTF-Transform logs every prune at info level; the build prints its own summary. */
export const QUIET = new Logger(Logger.Verbosity.WARN);

/** One NodeIO with every extension and the meshopt codecs (reads our own compressed output too). */
export function getIO(): Promise<NodeIO> {
  io ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]).then(
    () =>
      new NodeIO().setLogger(QUIET).registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
      }),
  );
  return io;
}

export async function readGlb(bytes: Uint8Array): Promise<Document> {
  return (await getIO()).readBinary(bytes).then((doc) => doc.setLogger(QUIET));
}

export async function writeGlb(doc: Document): Promise<Uint8Array> {
  return (await getIO()).writeBinary(doc);
}
