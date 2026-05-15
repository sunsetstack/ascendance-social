import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import { SearchAllQueryHandler } from "@/application/queries/search/searchAll/searchAll.handler";
import { SearchAllQuery } from "@/application/queries/search/searchAll/searchAll.query";

chai.use(chaiAsPromised);

describe("SearchAllQueryHandler", () => {
	let handler: SearchAllQueryHandler;
	let mockPostRepository: any;
	let mockUserRepository: any;
	let mockTagRepository: any;
	let mockCommunityRepository: any;
	let mockDTOService: any;

	beforeEach(() => {
		mockPostRepository = {
			findByTags: sinon.stub(),
			searchByText: sinon.stub(),
		};
		mockUserRepository = {
			getAll: sinon.stub(),
		};
		mockTagRepository = {
			searchTags: sinon.stub(),
		};
		mockCommunityRepository = {
			search: sinon.stub(),
		};
		mockDTOService = {
			toPostDTO: sinon.stub().returns({ publicId: "post-dto" }),
			toPublicDTO: sinon.stub().returns({ publicId: "user-dto" }),
			toCommunityDTO: sinon.stub().returns({ publicId: "community-dto" }),
		};

		handler = new SearchAllQueryHandler(
			mockPostRepository,
			mockUserRepository,
			mockTagRepository,
			mockCommunityRepository,
			mockDTOService,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("execute", () => {
		it("should call searchByText and include results", async () => {
			const query = new SearchAllQuery(["test"]);

			mockUserRepository.getAll.resolves([]);
			mockCommunityRepository.search.resolves([]);
			mockTagRepository.searchTags.resolves([]);

			const textPost = { publicId: "p1", body: "test post" };
			mockPostRepository.searchByText.resolves([textPost]);
			mockPostRepository.findByTags.resolves({ data: [] });

			mockDTOService.toPostDTO.withArgs(textPost).returns({ publicId: "p1", body: "test post" });

			const result = await handler.execute(query);

			expect(mockPostRepository.searchByText.calledWith(query.query)).to.be.true;
			expect(result.posts).to.have.lengthOf(1);
			expect(result.posts![0].publicId).to.equal("p1");
		});

		it("should deduplicate posts found by text and by tags", async () => {
			const query = new SearchAllQuery(["test"]);

			mockUserRepository.getAll.resolves([]);
			mockCommunityRepository.search.resolves([]);

			const tag = { _id: "tag1" };
			mockTagRepository.searchTags.resolves([tag]);

			const post1 = { publicId: "p1", body: "test post" };
			const post2 = { publicId: "p2", body: "other post" };

			// post1 found by text
			mockPostRepository.searchByText.resolves([post1]);
			// post1 AND post2 found by tag
			mockPostRepository.findByTags.resolves({ data: [post1, post2] });

			mockDTOService.toPostDTO.callsFake((post: any) => post);

			const result = await handler.execute(query);

			expect(mockPostRepository.searchByText.calledWith(query.query)).to.be.true;
			expect(mockPostRepository.findByTags.called).to.be.true;

			expect(result.posts).to.have.lengthOf(2);
			// Verify IDs present
			const ids = result.posts!.map((p) => p.publicId);
			expect(ids).to.include("p1");
			expect(ids).to.include("p2");
		});

		it("should handle null results from repositories", async () => {
			const query = new SearchAllQuery(["test"]);

			mockUserRepository.getAll.resolves(null);
			mockCommunityRepository.search.resolves(null);
			mockTagRepository.searchTags.resolves([]); 
			mockPostRepository.searchByText.resolves(null); 
			mockPostRepository.findByTags.resolves(null); 

			const result = await handler.execute(query);

			expect(result.posts).to.be.null;
			expect(result.users).to.be.null;
			expect(result.communities).to.be.null;
		});
	});
});
